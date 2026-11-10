package web

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
)

// cnaeData traz a lista oficial de subclasses do CNAE (IBGE), para traduzir o
// codigo em atividade sem depender de rede em tempo de execucao.
//
//go:embed data/cnae.json
var cnaeData []byte

var cnaeNonDigits = regexp.MustCompile(`\D`)

// CNAEActivity e o resultado da traducao de um codigo CNAE em atividade.
type CNAEActivity struct {
	Code      string `json:"cnae"`
	Atividade string `json:"atividade"`
	Termo     string `json:"termo"`
}

type cnaeEntry struct {
	ID        string     `json:"id"`
	Descricao string     `json:"descricao"`
	Classe    *cnaeEntry `json:"classe"`
}

var cnaeTable struct { //nolint:gochecknoglobals // tabela carregada uma vez
	once    sync.Once
	err     error
	list    []cnaeEntry
	byID    map[string]cnaeEntry
	byClass map[string]cnaeEntry
}

func loadCNAETable() error {
	cnaeTable.once.Do(func() {
		var entries []cnaeEntry
		if err := json.Unmarshal(cnaeData, &entries); err != nil {
			cnaeTable.err = fmt.Errorf("carregar tabela cnae: %w", err)

			return
		}

		cnaeTable.list = entries
		cnaeTable.byID = make(map[string]cnaeEntry, len(entries))
		cnaeTable.byClass = make(map[string]cnaeEntry, len(entries))

		for _, entry := range entries {
			cnaeTable.byID[entry.ID] = entry

			if entry.Classe != nil {
				cnaeTable.byClass[entry.Classe.ID] = *entry.Classe
			}
		}
	})

	return cnaeTable.err
}

// ResolveCNAE traduz um codigo CNAE (ex: "4711-3/02", "4711302" ou "4711") na
// atividade correspondente e em um termo curto, utilizavel como busca.
func ResolveCNAE(raw string) (CNAEActivity, error) {
	digits := cnaeNonDigits.ReplaceAllString(raw, "")
	if len(digits) < 4 {
		return CNAEActivity{}, fmt.Errorf("cnae invalido: informe ao menos 4 digitos")
	}

	entry, err := lookupCNAE(digits)
	if err != nil {
		return CNAEActivity{}, err
	}

	termo := cnaeSearchTerm(entry.Descricao)
	if alias, ok := cnaeAliases[entry.ID]; ok {
		termo = alias
	}

	return CNAEActivity{
		Code:      formatCNAE(entry.ID),
		Atividade: entry.Descricao,
		Termo:     termo,
	}, nil
}

func lookupCNAE(digits string) (cnaeEntry, error) {
	if err := loadCNAETable(); err != nil {
		return cnaeEntry{}, err
	}

	if len(digits) >= 7 {
		if entry, ok := cnaeTable.byID[digits[:7]]; ok {
			return entry, nil
		}
	}

	if len(digits) >= 5 {
		if classe, ok := cnaeTable.byClass[digits[:5]]; ok {
			return classe, nil
		}
	}

	// Codigo incompleto (ex: "4711"): usa a classe da primeira subclasse que
	// comece com os digitos informados.
	for _, entry := range cnaeTable.list {
		if strings.HasPrefix(entry.ID, digits) {
			if entry.Classe != nil {
				return *entry.Classe, nil
			}

			return entry, nil
		}
	}

	return cnaeEntry{}, fmt.Errorf("cnae %s nao encontrado", digits)
}

// formatCNAE devolve o codigo no formato oficial: 4711-3/02 ou 4711-3.
func formatCNAE(id string) string {
	switch len(id) {
	case 7:
		return id[:4] + "-" + id[4:5] + "/" + id[5:]
	case 5:
		return id[:4] + "-" + id[4:]
	default:
		return id
	}
}

// cnaeAliases troca a descricao oficial pelo termo que as pessoas realmente
// usam no Google Maps, para os CNAEs mais comuns.
var cnaeAliases = map[string]string{ //nolint:gochecknoglobals // tabela fixa
	"4711301": "hipermercado",
	"4711302": "supermercado",
	"4712100": "mercado",
	"4731800": "posto de combustível",
	"4744099": "material de construção",
	"4761003": "papelaria",
	"4771701": "farmácia",
	"4771702": "farmácia de manipulação",
	"4781400": "loja de roupas",
	"4789004": "pet shop",
	"4520001": "oficina mecânica",
	"4530703": "autopeças",
	"5510801": "hotel",
	"5611201": "restaurante",
	"5611203": "lanchonete",
	"5611204": "bar",
	"6201501": "empresa de software",
	"6810201": "imobiliária",
	"6911701": "advogado",
	"6920601": "contabilidade",
	"7500100": "veterinário",
	"8011101": "segurança privada",
	"8121400": "empresa de limpeza",
	"8630503": "clínica médica",
	"8630504": "dentista",
	"8650004": "fisioterapia",
	"9313100": "academia",
	"9511800": "assistência técnica de computadores",
	"9602501": "salão de beleza",
	"9602502": "clínica de estética",
}

var cnaeGenericPrefixes = []string{ //nolint:gochecknoglobals // tabela fixa
	"comércio varejista e atacadista de ",
	"comércio varejista de ",
	"comércio atacadista de ",
	"comércio a varejo de ",
	"comércio de ",
	"reparação e manutenção de ",
	"manutenção e reparação de ",
	"outras atividades de ",
	"atividades de ",
	"serviços de ",
	"serviço de ",
	"fabricação de ",
	"instalação de ",
	"locação de ",
	"ensino de ",
	"transporte de ",
}

var cnaeCuts = []string{ //nolint:gochecknoglobals // tabela fixa
	", ",
	" e outros",
	" e outras",
	" e similares",
	" exceto",
	" não ",
}

// cnaeSearchTerm reduz a descricao oficial a um termo curto que o Google Maps
// entende como tipo de estabelecimento.
func cnaeSearchTerm(desc string) string {
	term := strings.ToLower(strings.TrimSpace(desc))

	if idx := strings.LastIndex(term, " - "); idx >= 0 {
		term = term[idx+3:]
	}

	for _, prefix := range cnaeGenericPrefixes {
		if strings.HasPrefix(term, prefix) {
			term = strings.TrimPrefix(term, prefix)

			break
		}
	}

	for _, cut := range cnaeCuts {
		if idx := strings.Index(term, cut); idx > 0 {
			term = term[:idx]
		}
	}

	words := strings.Fields(term)
	if len(words) > 5 {
		words = words[:5]
	}

	term = strings.Join(words, " ")
	if term == "" {
		return strings.ToLower(strings.TrimSpace(desc))
	}

	return term
}

// apiResolveCNAE responde GET /api/v1/cnae/{code}.
func (s *Server) apiResolveCNAE(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		renderJSON(w, http.StatusMethodNotAllowed, apiError{
			Code:    http.StatusMethodNotAllowed,
			Message: methodNotAllowedMessage,
		})

		return
	}

	code := r.PathValue("code")
	if code == "" {
		renderJSON(w, http.StatusUnprocessableEntity, apiError{
			Code:    http.StatusUnprocessableEntity,
			Message: "informe um codigo CNAE",
		})

		return
	}

	activity, err := ResolveCNAE(code)
	if err != nil {
		renderJSON(w, http.StatusUnprocessableEntity, apiError{
			Code:    http.StatusUnprocessableEntity,
			Message: err.Error(),
		})

		return
	}

	renderJSON(w, http.StatusOK, activity)
}
