package web

import "testing"

func TestCNAESearchTerm(t *testing.T) {
	cases := map[string]string{
		"COMÉRCIO VAREJISTA DE MERCADORIAS EM GERAL, COM PREDOMINÂNCIA DE PRODUTOS ALIMENTÍCIOS - SUPERMERCADOS":                 "supermercados",
		"COMÉRCIO VAREJISTA DE MERCADORIAS EM GERAL, COM PREDOMINÂNCIA DE PRODUTOS ALIMENTÍCIOS - HIPERMERCADOS E SUPERMERCADOS": "hipermercados e supermercados",
		"RESTAURANTES E SIMILARES": "restaurantes",
		"BARES E OUTROS ESTABELECIMENTOS ESPECIALIZADOS EM SERVIR BEBIDAS, SEM ENTRETENIMENTO": "bares",
		"CABELEIREIROS, MANICURE E PEDICURE":                                                   "cabeleireiros",
		"ATIVIDADES DE FISIOTERAPIA":                                                           "fisioterapia",
		"TRANSPORTE RODOVIÁRIO COLETIVO DE PASSAGEIROS":                                        "transporte rodoviário coletivo de passageiros",
		"FABRICAÇÃO DE MÓVEIS DE MADEIRA PARA ESCRITÓRIOS, EXCETO ESTOFADOS":                   "móveis de madeira para escritórios",
	}

	for desc, want := range cases {
		if got := cnaeSearchTerm(desc); got != want {
			t.Errorf("cnaeSearchTerm(%q) = %q, esperado %q", desc, got, want)
		}
	}
}

func TestResolveCNAEBySubclass(t *testing.T) {
	activity, err := ResolveCNAE("4711-3/02")
	if err != nil {
		t.Fatalf("ResolveCNAE: %v", err)
	}

	if activity.Code != "4711-3/02" {
		t.Errorf("codigo = %q, esperado 4711-3/02", activity.Code)
	}

	if activity.Termo != "supermercado" {
		t.Errorf("termo = %q, esperado supermercado", activity.Termo)
	}
}

func TestResolveCNAEUsesAlias(t *testing.T) {
	cases := map[string]string{
		"8630-5/04": "dentista",
		"9313-1/00": "academia",
		"9602-5/01": "salão de beleza",
		"4771-7/01": "farmácia",
	}

	for code, want := range cases {
		activity, err := ResolveCNAE(code)
		if err != nil {
			t.Fatalf("ResolveCNAE(%s): %v", code, err)
		}

		if activity.Termo != want {
			t.Errorf("termo de %s = %q, esperado %q", code, activity.Termo, want)
		}
	}
}

func TestResolveCNAEByDigits(t *testing.T) {
	activity, err := ResolveCNAE("4711302")
	if err != nil {
		t.Fatalf("ResolveCNAE: %v", err)
	}

	if activity.Termo != "supermercado" {
		t.Errorf("termo = %q, esperado supermercado", activity.Termo)
	}
}

func TestResolveCNAEFallsBackToClass(t *testing.T) {
	activity, err := ResolveCNAE("4711-3/00")
	if err != nil {
		t.Fatalf("ResolveCNAE: %v", err)
	}

	if activity.Code != "4711-3" {
		t.Errorf("codigo = %q, esperado 4711-3", activity.Code)
	}
}

func TestResolveCNAEByPrefix(t *testing.T) {
	activity, err := ResolveCNAE("4711")
	if err != nil {
		t.Fatalf("ResolveCNAE: %v", err)
	}

	if activity.Code != "4711-3" || activity.Termo == "" {
		t.Errorf("resultado inesperado: %+v", activity)
	}
}

func TestResolveCNAEInvalid(t *testing.T) {
	if _, err := ResolveCNAE("47"); err == nil {
		t.Fatal("esperava erro para codigo curto")
	}

	if _, err := ResolveCNAE("9999-9/99"); err == nil {
		t.Fatal("esperava erro para codigo inexistente")
	}
}
