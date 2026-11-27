"""
Self-healing önerileri için onay ekranı (human-in-the-loop).

    pip install -r review/requirements.txt
    streamlit run review/app.py

AI'ın önerdiği locator düzeltmeleri burada listelenir. Hiçbir değişiklik onaysız koda
yazılmaz: önce Onayla / Reddet, sonra isteğe bağlı olarak "Onaylananları koda uygula".
"""
import json
from datetime import datetime
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
SUGGESTIONS = ROOT / "results" / "healing" / "suggestions.json"
DECISIONS = ROOT / "results" / "healing" / "decisions.json"

STATUS_LABEL = {
    "healed": "🩹 Onarıldı",
    "refused": "🛑 AI onarmadı",
    "invalid": "⚠️ Öneri doğrulanamadı",
}
OUTCOME_LABEL = {
    "DOĞRU_ONARIM": "✅ Doğru onarım",
    "DOĞRU_RED": "✅ Doğru red",
    "YANLIŞ_ONARIM": "❌ Yanlış elemente onardı",
    "SAHTE_ONARIM": "🚨 Sahte onarım: gerçek bir bug'ı gizledi",
    "KAÇIRILAN_ONARIM": "➖ Onarması gerekiyordu",
}


def load(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_decisions(decisions: dict):
    DECISIONS.parent.mkdir(parents=True, exist_ok=True)
    DECISIONS.write_text(json.dumps(decisions, ensure_ascii=False, indent=2), encoding="utf-8")


def apply_change(location: str, old: str, new: str) -> str:
    """Eski selector'ı belirtilen satırda yenisiyle değiştirir. Sonucu açıklayan bir metin döndürür."""
    if not location or ":" not in location:
        return "Konum bilinmiyor, elle değiştir."
    file_part, line_part = location.rsplit(":", 1)
    path = ROOT / file_part
    try:
        line_no = int(line_part)
        lines = path.read_text(encoding="utf-8").split("\n")
    except (ValueError, FileNotFoundError):
        return f"{location} okunamadı, elle değiştir."
    line = lines[line_no - 1]
    start = line.find(old)
    if start < 0:
        return f"{location}: eski selector bu satırda yok (zaten değişmiş olabilir)."
    quote = line[start - 1] if start > 0 else ""
    if quote in "'\"`" and quote in new:
        return f"{location}: yeni selector {quote} karakteri içeriyor, elle değiştir."
    lines[line_no - 1] = line.replace(old, new, 1)
    path.write_text("\n".join(lines), encoding="utf-8")
    return f"{location}: güncellendi."


st.set_page_config(page_title="Self-healing onay ekranı", page_icon="🩹", layout="wide")
st.title("🩹 Self-healing onay ekranı")
st.caption("AI'ın önerdiği locator düzeltmeleri. Hiçbiri sen onaylamadan koda yazılmaz.")

suggestions = load(SUGGESTIONS, [])
decisions = load(DECISIONS, {})

if not suggestions:
    st.info("Henüz öneri yok. Önce `npm run heal` ve `npm run heal:evaluate` çalıştır.")
    st.stop()

with st.sidebar:
    st.header("Özet")
    healed = [s for s in suggestions if s.get("status") == "healed"]
    st.metric("AI önerisi", len(healed))
    st.metric("Onaylanan", sum(1 for s in healed if decisions.get(s["test"], {}).get("decision") == "approved"))
    st.metric("Reddedilen", sum(1 for s in healed if decisions.get(s["test"], {}).get("decision") == "rejected"))
    st.divider()
    show_truth = st.toggle(
        "Değerlendirme sonucunu göster",
        value=False,
        help="Demo'da doğru cevaplar biliniyor. Gerçek projede bu bilgi olmaz; önce kendin karar verip sonra açabilirsin.",
    )

for s in suggestions:
    test = s["test"]
    decision = decisions.get(test, {}).get("decision")
    with st.container(border=True):
        left, right = st.columns([3, 1])
        with left:
            st.subheader(test)
            st.markdown(f"**Durum:** {STATUS_LABEL.get(s.get('status'), s.get('status'))} · **Güven:** %{round((s.get('confidence') or 0) * 100)}")
            st.markdown(f"**Amaç:** {s.get('intent', '')}")
            st.code(f"- {s.get('oldSelector')}\n+ {s.get('newSelector') or '(öneri yok)'}", language="diff")
            st.markdown(f"**AI'ın gerekçesi:** {s.get('reason', '')}")
            if s.get("location"):
                st.caption(f"Kodda: `{s['location']}`")
            if show_truth and s.get("outcome"):
                st.markdown(f"**Değerlendirme:** {OUTCOME_LABEL.get(s['outcome'], s['outcome'])}")
        with right:
            if s.get("status") != "healed":
                st.write("Onaylanacak bir öneri yok.")
                continue
            if decision == "approved":
                st.success("Onaylandı")
            elif decision == "rejected":
                st.error("Reddedildi")
            c1, c2 = st.columns(2)
            if c1.button("Onayla", key=f"ok-{test}", use_container_width=True):
                decisions[test] = {"decision": "approved", "at": datetime.now().isoformat(timespec="seconds")}
                save_decisions(decisions)
                st.rerun()
            if c2.button("Reddet", key=f"no-{test}", use_container_width=True):
                decisions[test] = {"decision": "rejected", "at": datetime.now().isoformat(timespec="seconds")}
                save_decisions(decisions)
                st.rerun()

st.divider()
approved = [s for s in suggestions if s.get("status") == "healed" and decisions.get(s["test"], {}).get("decision") == "approved"]
st.subheader(f"Onaylananları koda uygula ({len(approved)})")
st.caption("Eski selector, test dosyasındaki satırında yenisiyle değiştirilir. Değişikliği git diff ile kontrol edebilirsin.")
confirm = st.checkbox("Onayladığım değişikliklerin test dosyalarına yazılmasını istiyorum")
if st.button("Uygula", disabled=not (approved and confirm), type="primary"):
    for s in approved:
        st.write(apply_change(s.get("location") or "", s["oldSelector"], s["newSelector"]))
        decisions[s["test"]]["applied"] = True
    save_decisions(decisions)
