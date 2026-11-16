#!/usr/bin/env python3
"""Consulta rápida na base local cnpj-sp.db por CNAE + Município (SP) + filtro MEI."""
import json
import sqlite3
import sys
import unicodedata
from pathlib import Path

DB_PATH = Path("/root/wins-hub/data/cnpj-sp.db")


def norm_text(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.upper().strip().split())


def stem_pt(token: str) -> str:
    if len(token) >= 6 and token.endswith(("OS", "AS", "ES")):
        return token[:-2]
    if len(token) >= 5 and token.endswith(("O", "A", "S")):
        return token[:-1]
    return token


CNAE_SYNONYMS = {
    "ZOOTECNIST": ["7490103", "0162803", "7500100"],
    "AGRONOM": ["7490103"],
    "DENTIST": ["ODONTOLOG"],
    "ADVOGAD": ["6911701", "ADVOCACIA"],
    "CONTADOR": ["6920601", "CONTABILIDADE"],
    "BARBEIR": ["9602501", "CABELEIREIROS"],
    "BARBEARI": ["9602501", "CABELEIREIROS"],
    "ADEG": ["4723700"],
    "TABACARI": ["4729601"],
    "MECANIC": ["4520001", "MANUTENCAO REPARACAO VEICULOS"],
    "OFICIN": ["4520001"],
    "CONCESSIONARI": ["4511101", "4511102"],
    "ESTETICIST": ["9602502"],
    "ESTETIC": ["9602502"],
    "PSICOLOG": ["8650003"],
    "NUTRICIONIST": ["8650002"],
    "FISIOTERAPEUT": ["8650004"],
    "ACADEMI": ["9313100"],
    "PETSHOP": ["4789004", "9609208"],
    "PET": ["4789004", "9609208", "7500100"],
    "PADARI": ["4721102", "1091102"],
    "MARMITARI": ["5620104"],
    "ELETRICIST": ["4321500"],
    "ENCANADOR": ["4322301"],
    "ARQUITET": ["7111100"],
    "ENGENHEIR": ["7112000"],
}


def resolve_cnae_codes(conn: sqlite3.Connection, cnae_input: str) -> list[str]:
    kw = norm_text(cnae_input)
    tokens = [stem_pt(t) for t in kw.split() if len(t) >= 3] or [stem_pt(kw)]
    all_cnaes = [(r["codigo"], norm_text(r["descricao"])) for r in conn.execute("SELECT codigo, descricao FROM cnaes").fetchall()]

    matched = [cod for cod, desc in all_cnaes if all(t in desc for t in tokens)]
    if matched:
        return matched[:20]

    syn_codes = []
    for t in tokens:
        for key, targets in CNAE_SYNONYMS.items():
            if t == key or t.startswith(key) or key.startswith(t):
                for tgt in targets:
                    if tgt.isdigit() and len(tgt) == 7:
                        if tgt not in syn_codes:
                            syn_codes.append(tgt)
                    else:
                        sub_tokens = tgt.split()
                        for cod, desc in all_cnaes:
                            if all(st in desc for st in sub_tokens) and cod not in syn_codes:
                                syn_codes.append(cod)
    if syn_codes:
        return syn_codes[:20]

    # Fallback: prefixo de 6 letras para termos longos sem match exato
    long_tokens = [t[:6] for t in tokens if len(t) >= 7]
    if long_tokens:
        return [cod for cod, desc in all_cnaes if all(lt in desc for lt in long_tokens)][:20]
    return []


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if not DB_PATH.exists():
        print(json.dumps({"ok": True, "ready": False, "status": "not_started", "progress": "Base ainda não importada"}))
        return

    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    meta = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM meta").fetchall()}

    if cmd == "status":
        print(json.dumps({
            "ok": True,
            "ready": meta.get("status") == "ready",
            "status": meta.get("status", "unknown"),
            "competencia": meta.get("competencia", ""),
            "progress": meta.get("progress", ""),
            "total_sp": int(meta.get("total_sp") or 0),
            "total_mei": int(meta.get("total_mei") or 0),
        }))
        return

    if cmd == "search":
        payload = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
        if meta.get("status") != "ready":
            print(json.dumps({"ok": False, "error": f"Base CNAE SP ainda importando: {meta.get('progress', '')}"}))
            return

        cnae_input = str(payload.get("cnae", "")).strip()
        cnae_raw = "".join(c for c in cnae_input if c.isdigit())
        loc_raw = str(payload.get("cidade", "São Paulo")).strip() or "São Paulo"
        loc_parts = [p.strip() for part in loc_raw.split(",") for p in part.split("-") if p.strip() and norm_text(p) not in ("SP", "SAO PAULO SP", "BRASIL", "BRAZIL")]
        if not loc_parts:
            loc_parts = ["São Paulo"]
        mei_only = bool(payload.get("meiOnly", True))
        limit = min(200, max(1, int(payload.get("limit", 60))))

        mun_row = None
        for cand in loc_parts:
            mun_row = conn.execute(
                """SELECT m.codigo, m.nome FROM municipios m
                   WHERE m.nome_norm = ?
                     AND EXISTS (SELECT 1 FROM estabelecimentos e WHERE e.municipio = m.codigo)
                   LIMIT 1""",
                (norm_text(cand),),
            ).fetchone()
            if mun_row:
                break
        if not mun_row:
            for cand in loc_parts:
                if len(cand) < 4:
                    continue
                mun_row = conn.execute(
                    """SELECT m.codigo, m.nome FROM municipios m
                       WHERE m.nome_norm LIKE ?
                         AND EXISTS (SELECT 1 FROM estabelecimentos e WHERE e.municipio = m.codigo)
                       LIMIT 1""",
                    (f"%{norm_text(cand)}%",),
                ).fetchone()
                if mun_row:
                    break
        if not mun_row and "SP" in norm_text(loc_raw).split():
            mun_row = conn.execute("SELECT codigo, nome FROM municipios WHERE codigo = '7107' LIMIT 1").fetchone()
        if not mun_row:
            print(json.dumps({"ok": False, "error": f"Município '{loc_parts[0]}' não encontrado na base"}))
            return

        mun_cod = mun_row["codigo"]
        where = ["municipio = ?"]
        params = [mun_cod]
        cnae_label = cnae_raw
        if len(cnae_raw) == 7:
            where.append("cnae_principal = ?")
            params.append(cnae_raw)
        elif len(cnae_raw) >= 4:
            where.append("cnae_principal LIKE ?")
            params.append(f"{cnae_raw}%")
        elif cnae_input:
            matched_codes = resolve_cnae_codes(conn, cnae_input)
            if not matched_codes:
                print(json.dumps({"ok": False, "error": f"Nenhum CNAE encontrado para '{cnae_input}'"}))
                return
            placeholders = ",".join("?" for _ in matched_codes)
            where.append(f"cnae_principal IN ({placeholders})")
            params.extend(matched_codes)
            cnae_label = matched_codes[0] if len(matched_codes) == 1 else f"{cnae_input} ({len(matched_codes)} CNAEs)"
        if mei_only:
            where.append("optante_mei = 'S'")

        sql = f"""
            SELECT cnpj, nome_fantasia, razao_social, porte,
                   cnae_principal, endereco, bairro, cep,
                   telefone, telefone2, email, optante_mei
            FROM estabelecimentos
            WHERE {' AND '.join(where)}
            ORDER BY contact_score DESC
            LIMIT ?
        """
        params.append(limit)
        rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
        print(json.dumps({
            "ok": True,
            "municipio": mun_row["nome"],
            "cnae": cnae_label,
            "meiOnly": mei_only,
            "count": len(rows),
            "rows": rows,
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()
