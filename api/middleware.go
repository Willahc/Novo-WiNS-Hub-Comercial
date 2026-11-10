package apiimport (
	"context"
	"net/http"
	"strings"
	"encoding/base64"
)


type contextKey string

const apiKeyContextKey contextKey = "api_key"

// KeyInfo represents minimal API key information stored in context.
type KeyInfo struct {
	ID   int
	Name string
}

// ValidateKeyFunc is a function that validates an API key and returns key info.
type ValidateKeyFunc func(ctx context.Context, key string) (keyID int, keyName string, err error)

// KeyAuth middleware validates API keys from Authorization, X-API-Key, or Basic headers.
func KeyAuth(validateKey ValidateKeyFunc) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Check Authorization header
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				// Also check X-API-Key header
				authHeader = r.Header.Get("X-API-Key")
			}

			if authHeader == "" {
				http.Error(w, `{"error": "missing api key"}`, http.StatusUnauthorized)
				return
			}

			// Extract the key based on the auth scheme
			key := authHeader
			scheme := strings.TrimPrefix(strings.ToLower(authHeader), " ")
			if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
				key = strings.TrimPrefix(authHeader, "Bearer ")
			} else if strings.HasPrefix(strings.ToLower(authHeader), "basic ") {
				// Decode Basic auth credentials
				authBytes, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(authHeader, "Basic "))
				if err == nil {
					authParts := strings.SplitN(string(authBytes), ":", 2)
					if len(authParts) == 2 {
						key = authParts[1]
					}
				}
			}

			keyID, keyName, err := validateKey(r.Context(), key)
			if err != nil {
				http.Error(w, `{"error": "invalid api key"}`, http.StatusUnauthorized)
				return
			}

			apiKeyInfo := &KeyInfo{ID: keyID, Name: keyName}
			ctx := context.WithValue(r.Context(), apiKeyContextKey, apiKeyInfo)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// KeyFromContext retrieves the API key info from context.
func KeyFromContext(ctx context.Context) *KeyInfo {
	if key, ok := ctx.Value(apiKeyContextKey).(*KeyInfo); ok {
		return key
	}

	return nil
}
