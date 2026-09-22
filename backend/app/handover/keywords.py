"""THE FILE TO EDIT when tuning hard handover rules.

Nothing here is logic — just lists of trigger terms per category, in English
and Arabic. Matching lives in app/handover/policy.py, and the orchestrator
never sees these lists directly.

HOW MATCHING WORKS, so the entries you add behave the way you expect:

  * Case is ignored, and Arabic is normalised first: diacritics and tatweel are
    stripped, and أ إ آ ٱ all become ا, ى becomes ي. So "ألم" matches "الم".
  * A single-word entry matches whole words only. "urgent" will not fire on
    "urgently" being part of a longer compound, and "دم" will not fire inside a
    longer word.
  * An entry containing a space is matched as a phrase, anywhere in the
    message. "chargeback dispute" fires on "I filed a chargeback dispute
    yesterday".
  * Every category is checked. The reason recorded on the conversation lists
    each category that matched and the specific terms.

TUNING NOTES from writing this list:

  * Prefer terms that only ever signal a real concern. Plenty of ordinary
    support words are also innocuous enquiries in other contexts — be
    deliberate about what goes in here, since a false handover costs a staff
    member a few seconds and a missed one can mean a customer with a real
    problem talking to a bot.
  * Bias towards handing over, but not so far that the queue becomes noise.
  * Add terms as you see real messages. That is the whole point of this file.
  * Arabic BROKEN PLURALS need their own entry. Matching tolerates the definite
    article and regular endings (ات ين ون ه ي ك ها نا), so "طارئ" catches
    "طارئة". It cannot catch an irregular broken plural that rewrites the
    middle of the word. When you add an Arabic singular, add its plural too if
    it is irregular.
"""

# Anything time-critical, or that the customer is treating as urgent. These
# skip the AI and should ideally page someone.
URGENT = [
    # English
    "emergency", "urgent", "urgently", "asap", "right now", "immediately",
    "critical", "severe", "unbearable", "getting worse", "escalate",
    "escalation", "time sensitive", "time-sensitive", "deadline today",
    # Arabic
    "طارئ", "طوارئ", "عاجل", "بسرعه", "حالا", "فوري",
    "شديد", "لا يحتمل", "يزداد سوءا", "تصعيد",
]

# Anything with a safety or legal edge. Never let a bot answer these.
SAFETY_LEGAL = [
    # English
    "unsafe", "dangerous", "hazard", "injury", "injured", "hurt someone",
    "lawyer", "legal", "sue", "suing", "lawsuit", "court", "liability",
    "negligent", "negligence", "regulator", "report you", "data breach",
    "privacy violation", "gdpr", "fraud", "fraudulent", "scam",
    # Arabic
    "غير آمن", "خطر", "اصابه", "محامي", "قانوني", "دعوى قضائيه",
    "محكمه", "اهمال", "جهه رقابيه", "اختراق بيانات", "احتيال", "نصب",
]

# Money the customer wants back or disputes, and anything with a billing edge
# serious enough that a bot should not be the one resolving it.
BILLING_DISPUTE = [
    # English
    "refund", "money back", "chargeback", "dispute this charge",
    "unauthorized charge", "unauthorised charge", "double charged",
    "overcharged", "billing error", "wrong invoice", "cancel my subscription",
    "compensation", "reimburse", "reimbursement",
    # Arabic
    "استرداد", "استرجاع المبلغ", "اعتراض على الفاتوره", "رسوم غير مصرح بها",
    "تحصيل مضاعف", "خطأ في الفاتوره", "الغاء الاشتراك", "تعويض",
]

# Unhappy customers and anything that asks for a human by name.
COMPLAINTS = [
    # English
    "complaint", "complain", "complaining", "unhappy", "dissatisfied",
    "terrible", "awful", "worst", "unacceptable", "disgusting",
    "made it worse", "ruined", "speak to a manager", "speak to the manager",
    "speak to a human", "speak to someone", "talk to a person",
    "real person", "not a bot",
    # Arabic
    "شكوى", "اشتكي", "شكايه", "غير راض", "مستاء",
    "سيء", "اسوا", "غير مقبول", "افسدت", "زاد سوءا",
    "اريد التحدث مع موظف", "مع شخص", "لست روبوت", "موظف حقيقي",
]

#: Category name -> terms. The orchestrator records which categories matched.
KEYWORD_CATEGORIES: dict[str, list[str]] = {
    "urgent": URGENT,
    "safety_legal": SAFETY_LEGAL,
    "billing_dispute": BILLING_DISPUTE,
    "complaints": COMPLAINTS,
}
