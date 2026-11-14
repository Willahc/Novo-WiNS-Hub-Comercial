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
                "SELECT codigo, nome FROM municipios WHERE nome_norm = ? LIMIT 1",
                (norm_text(cand),),
            ).fetchone()
            if mun_row:
                break
        if not mun_row:
            for cand in loc_parts:
                if len(cand) < 4:
                    continue
                mun_row = conn.execute(
                    "SELECT codigo, nome FROM municipios WHERE nome_norm LIKE ? LIMIT 1",
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
            kw = norm_text(cnae_input)
            tokens = [stem_pt(t) for t in kw.split() if len(t) >= 3]
            if not tokens:
                tokens = [stem_pt(kw)]
            matched_codes = [
                r["codigo"]
                for r in conn.execute("SELECT codigo, descricao FROM cnaes").fetchall()
                if all(t in norm_text(r["descricao"]) for t in tokens)
            ][:20]
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
