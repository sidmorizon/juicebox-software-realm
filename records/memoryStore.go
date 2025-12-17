package records

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"os"
	"sync"

	"github.com/juicebox-systems/juicebox-software-realm/otel"
	"github.com/juicebox-systems/juicebox-software-realm/types"
	semconv "go.opentelemetry.io/otel/semconv/v1.17.0"
	"go.opentelemetry.io/otel/trace"
)

type MemoryRecordStore struct {
	lock     sync.Mutex
	records  map[UserRecordID]UserRecord
	filePath string
}

// ============================================
// Hex 序列化结构（所有 buffer 用 hex 字符串存储）
// ============================================

type persistedData struct {
	Records map[string]persistedUserRecord `json:"records"`
}

type persistedUserRecord struct {
	RegistrationState string                   `json:"registration_state"` // "Registered", "NotRegistered", "NoGuesses"
	Registered        *persistedRegistered     `json:"registered,omitempty"`
}

type persistedRegistered struct {
	Version                   string                       `json:"version"`
	OprfPrivateKey            string                       `json:"oprf_private_key"`
	OprfSignedPublicKey       persistedOprfSignedPublicKey `json:"oprf_signed_public_key"`
	UnlockKeyCommitment       string                       `json:"unlock_key_commitment"`
	UnlockKeyTag              string                       `json:"unlock_key_tag"`
	EncryptionKeyScalarShare  string                       `json:"encryption_key_scalar_share"`
	EncryptedSecret           string                       `json:"encrypted_secret"`
	EncryptedSecretCommitment string                       `json:"encrypted_secret_commitment"`
	GuessCount                uint16                       `json:"guess_count"`
	Policy                    types.Policy                 `json:"policy"`
}

type persistedOprfSignedPublicKey struct {
	PublicKey    string `json:"public_key"`
	VerifyingKey string `json:"verifying_key"`
	Signature    string `json:"signature"`
}

// UserRecord -> persistedUserRecord
func toPersistedRecord(ur UserRecord) persistedUserRecord {
	switch state := ur.RegistrationState.(type) {
	case Registered:
		return persistedUserRecord{
			RegistrationState: "Registered",
			Registered: &persistedRegistered{
				Version:            hex.EncodeToString(state.Version[:]),
				OprfPrivateKey:     hex.EncodeToString(state.OprfPrivateKey[:]),
				OprfSignedPublicKey: persistedOprfSignedPublicKey{
					PublicKey:    hex.EncodeToString(state.OprfSignedPublicKey.PublicKey[:]),
					VerifyingKey: hex.EncodeToString(state.OprfSignedPublicKey.VerifyingKey[:]),
					Signature:    hex.EncodeToString(state.OprfSignedPublicKey.Signature[:]),
				},
				UnlockKeyCommitment:       hex.EncodeToString(state.UnlockKeyCommitment[:]),
				UnlockKeyTag:              hex.EncodeToString(state.UnlockKeyTag[:]),
				EncryptionKeyScalarShare:  hex.EncodeToString(state.EncryptionKeyScalarShare[:]),
				EncryptedSecret:           hex.EncodeToString(state.EncryptedSecret[:]),
				EncryptedSecretCommitment: hex.EncodeToString(state.EncryptedSecretCommitment[:]),
				GuessCount:                state.GuessCount,
				Policy:                    state.Policy,
			},
		}
	case NoGuesses:
		return persistedUserRecord{RegistrationState: "NoGuesses"}
	default: // NotRegistered
		return persistedUserRecord{RegistrationState: "NotRegistered"}
	}
}

// persistedUserRecord -> UserRecord
func fromPersistedRecord(pr persistedUserRecord) (UserRecord, error) {
	switch pr.RegistrationState {
	case "Registered":
		if pr.Registered == nil {
			return UserRecord{}, errors.New("missing registered data")
		}
		r := pr.Registered

		version, _ := hex.DecodeString(r.Version)
		oprfPrivateKey, _ := hex.DecodeString(r.OprfPrivateKey)
		publicKey, _ := hex.DecodeString(r.OprfSignedPublicKey.PublicKey)
		verifyingKey, _ := hex.DecodeString(r.OprfSignedPublicKey.VerifyingKey)
		signature, _ := hex.DecodeString(r.OprfSignedPublicKey.Signature)
		unlockKeyCommitment, _ := hex.DecodeString(r.UnlockKeyCommitment)
		unlockKeyTag, _ := hex.DecodeString(r.UnlockKeyTag)
		encryptionKeyScalarShare, _ := hex.DecodeString(r.EncryptionKeyScalarShare)
		encryptedSecret, _ := hex.DecodeString(r.EncryptedSecret)
		encryptedSecretCommitment, _ := hex.DecodeString(r.EncryptedSecretCommitment)

		reg := Registered{
			GuessCount: r.GuessCount,
			Policy:     r.Policy,
		}
		copy(reg.Version[:], version)
		copy(reg.OprfPrivateKey[:], oprfPrivateKey)
		copy(reg.OprfSignedPublicKey.PublicKey[:], publicKey)
		copy(reg.OprfSignedPublicKey.VerifyingKey[:], verifyingKey)
		copy(reg.OprfSignedPublicKey.Signature[:], signature)
		copy(reg.UnlockKeyCommitment[:], unlockKeyCommitment)
		copy(reg.UnlockKeyTag[:], unlockKeyTag)
		copy(reg.EncryptionKeyScalarShare[:], encryptionKeyScalarShare)
		copy(reg.EncryptedSecret[:], encryptedSecret)
		copy(reg.EncryptedSecretCommitment[:], encryptedSecretCommitment)

		return UserRecord{RegistrationState: reg}, nil
	case "NoGuesses":
		return UserRecord{RegistrationState: NoGuesses{}}, nil
	default: // "NotRegistered"
		return DefaultUserRecord(), nil
	}
}

func NewMemoryRecordStore() RecordStore {
	// 从环境变量获取持久化文件路径，默认不持久化
	filePath := os.Getenv("MEMORY_STORE_FILE")

	store := &MemoryRecordStore{
		records:  make(map[UserRecordID]UserRecord),
		filePath: filePath,
	}

	// 如果指定了文件路径，尝试从文件加载数据
	if filePath != "" {
		if err := store.loadFromFile(); err != nil {
			log.Printf("Memory store: could not load from file %s: %v", filePath, err)
		} else {
			log.Printf("Memory store: loaded %d records from %s", len(store.records), filePath)
		}
	}

	return store
}

// loadFromFile 从文件加载数据
func (m *MemoryRecordStore) loadFromFile() error {
	if m.filePath == "" {
		return nil
	}

	data, err := os.ReadFile(m.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // 文件不存在，正常情况
		}
		return err
	}

	var persisted persistedData
	if err := json.Unmarshal(data, &persisted); err != nil {
		return err
	}

	// 将持久化格式转换回 UserRecord
	for keyStr, persistedRecord := range persisted.Records {
		record, err := fromPersistedRecord(persistedRecord)
		if err != nil {
			log.Printf("Memory store: failed to parse record %s: %v", keyStr, err)
			continue
		}
		m.records[UserRecordID(keyStr)] = record
	}

	return nil
}

// saveToFile 保存数据到文件（所有 buffer 用 hex 字符串存储）
func (m *MemoryRecordStore) saveToFile() error {
	if m.filePath == "" {
		return nil
	}

	// 将 UserRecord 转换为持久化格式
	persisted := persistedData{
		Records: make(map[string]persistedUserRecord),
	}
	for recordID, record := range m.records {
		persisted.Records[string(recordID)] = toPersistedRecord(record)
	}

	data, err := json.MarshalIndent(persisted, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(m.filePath, data, 0600)
}

func (m *MemoryRecordStore) GetRecord(ctx context.Context, recordID UserRecordID) (UserRecord, interface{}, error) {
	_, span := otel.StartSpan(
		ctx,
		"GetRecord",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(semconv.DBSystemKey.String("memory")),
	)
	defer span.End()

	m.lock.Lock()
	defer m.lock.Unlock()

	record, ok := m.records[recordID]
	if !ok {
		return DefaultUserRecord(), nil, nil
	}
	return record, record, nil
}

func (m *MemoryRecordStore) WriteRecord(ctx context.Context, recordID UserRecordID, record UserRecord, readRecord interface{}) error {
	_, span := otel.StartSpan(
		ctx,
		"WriteRecord",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(semconv.DBSystemKey.String("memory")),
	)
	defer span.End()

	m.lock.Lock()
	defer m.lock.Unlock()

	existingRecord, exists := m.records[recordID]
	if !exists && readRecord == nil || existingRecord == readRecord {
		m.records[recordID] = record

		// 持久化到文件
		if m.filePath != "" {
			if err := m.saveToFile(); err != nil {
				log.Printf("Memory store: failed to save to file: %v", err)
			}
		}

		return nil
	}

	err := errors.New("record was unexpectedly mutated before write")
	return otel.RecordOutcome(err, span)
}
