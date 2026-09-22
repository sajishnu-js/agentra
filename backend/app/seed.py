"""Seed the database with realistic fake rows.

    python -m app.seed          (from the backend/ directory)
    make seed                   (from the repo root)

Idempotent: it clears the tables it owns and rewrites them, so running it
twice leaves the same state rather than duplicating rows. It refuses to run
outside ENVIRONMENT=local, because it starts with DELETE.

Everything here — the 5 industry AI agents (real estate, beauty & wellness,
automotive, home services, and hospitality), their 5 dedicated knowledge
bases (real embeddings via embed_passages, not a fake vector), and the 5
demo conversations — lives in this one script now, so `make seed` reproduces
the whole workspace in one deterministic pass instead of depending on a
separate, easy-to-forget ingestion step. Exactly 5 agents, 5 knowledge
bases (each 1:1 with its agent), and 5 conversations (one per agent) — not
"realistic volume," a small, legible fixture that still gives the dashboard
and the Requests Hub real, internally-consistent data to show.

None of this is real staff or customer data. Names are generic placeholders
("Person 1", ...), and the phone numbers use UAE prefixes but are invented.
"""

import asyncio
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete

from app.core.config import settings
from app.core.database import SessionLocal
from app.domains.agents.models import Agent, AgentStatus
from app.domains.auth.permissions import DEFAULT_ADMIN_PERMISSIONS
from app.domains.contacts.models import Channel, Contact
from app.domains.conversations.models import (
    Conversation,
    ConversationStatus,
    Message,
    MessageDirection,
    MessageStatus,
)
from app.domains.inboxes.models import Inbox, InboxStatus
from app.domains.knowledge_base.embedding import embed_passages
from app.domains.knowledge_base.models import (
    KBChunk,
    KBDocument,
    KBTable,
    KBTableRow,
    KnowledgeBase,
    SourceType,
)
from app.domains.requests.models import (
    Request,
    RequestCategory,
    RequestPriority,
    RequestStatus,
)
from app.domains.users.models import User, UserRole
from app.domains.workflows.models import Workflow, WorkflowStatus

NOW = datetime.now(UTC)


def minutes_ago(minutes: float) -> datetime:
    return NOW - timedelta(minutes=minutes)


# ---------------------------------------------------------------------------
# The 5 industry specialists — name, persona, and the knowledge base each
# one is dedicated to. Written with the same depth as a production agent
# would need (not placeholder prompts), matching the Agent Configuration
# Studio's own fields exactly. Each KB carries several documents and
# several structured tables, because that is what makes retrieval useful.
# ---------------------------------------------------------------------------

AGENT_DEFS = [
    # -----------------------------------------------------------------
    # 1. Real estate & holiday homes
    # -----------------------------------------------------------------
    {
        "key": "realestate",
        "name": "Real Estate & Holiday Home Specialist",
        "description": (
            "Handles UAE property inquiries, lead qualification, viewing "
            "bookings, tenant maintenance requests, and RERA/Ejari compliance "
            "questions."
        ),
        "icon": "Building2",
        "system_prompt": (
            "You are the Real Estate & Holiday Home Specialist for a "
            "RERA-registered brokerage and holiday-home operator in the UAE. "
            "You are the first point of contact for buyers, tenants, holiday "
            "home guests, and landlords across Dubai, Abu Dhabi, Sharjah and "
            "Ras Al Khaimah.\n\n"
            "WHAT YOU HANDLE\n"
            "1. Property inquiries — availability, size, layout, view, floor, "
            "furnishing status, service charges, parking, and handover date. "
            "Always confirm which community and unit type the person means "
            "before quoting anything, because pricing varies sharply between "
            "communities and even between towers in the same community.\n"
            "2. Lead qualification — before booking a viewing, establish: "
            "buy or rent; budget range; preferred communities; number of "
            "bedrooms; whether they need a mortgage or are a cash buyer; "
            "intended move-in date; and whether they are currently in the UAE "
            "or overseas. Capture these conversationally, a couple at a time, "
            "not as an interrogation.\n"
            "3. Viewings — offer concrete slots, confirm the meeting point, "
            "and tell the client what to bring (Emirates ID or passport copy "
            "for building access at most towers).\n"
            "4. Holiday-home bookings — nightly rates, minimum stay, check-in "
            "and check-out times, the security deposit, and the DTCM tourism "
            "fee per night.\n"
            "5. Tenant maintenance — log the issue, its urgency, and the unit "
            "number, and explain who bears the cost under the tenancy "
            "contract.\n"
            "6. RERA and Ejari — explain the Ejari registration process, what "
            "documents a tenant needs, the standard agency and security "
            "deposit percentages, and the 90-day renewal notice rule.\n\n"
            "HOW YOU WORK\n"
            "Always ground answers in the knowledge base: quote real service "
            "charge figures, real commission percentages, and the actual "
            "notice periods rather than approximations. When a client asks "
            "for something priced, state the figure, the unit it is measured "
            "in (per sq ft per year, per night, percent of annual rent), and "
            "what it does and does not include. If the person writes in "
            "Arabic, reply in Arabic."
        ),
        "guardrails": (
            "Never quote a final sale price, agree a rent reduction, or "
            "commit to any discount — pricing negotiation is the listing "
            "agent's decision, and you may only state the published asking "
            "price and the standard fee structure. Never guarantee mortgage "
            "approval, quote an interest rate as if it were confirmed, or "
            "advise on whether someone will qualify; direct all financing "
            "questions to a registered mortgage advisor. Never give legal "
            "advice on a tenancy dispute, eviction, or rent-increase "
            "challenge — explain the RERA process and refer the person to the "
            "Rental Dispute Centre. Never share a landlord's personal "
            "contact details, another tenant's information, or a unit's "
            "occupancy history. Do not confirm that a specific unit is "
            "available for a specific date without a colleague verifying the "
            "calendar; say you will confirm and hand over. Never collect card "
            "numbers, bank details or passport scans in chat — always issue a "
            "secure payment link instead."
        ),
        "response_behaviour": (
            "Warm, consultative, and concrete — you are helping someone make "
            "a significant financial decision, so be precise rather than "
            "salesy. Two to four sentences for a routine question. Use a "
            "short bulleted list only when presenting three or more distinct "
            "options (available units, viewing slots, document checklists). "
            "Always give real numbers with their unit and what they cover. "
            "Close a qualifying exchange with one clear next step — a viewing "
            "slot, a document to send, or a callback window. Mirror the "
            "customer's language: reply in Arabic to Arabic, English to "
            "English, and keep any Arabic reply in Modern Standard Arabic "
            "with Gulf-appropriate courtesy."
        ),
        "fallback_message": (
            "Thank you for your interest — one of our RERA-registered "
            "property consultants will contact you shortly to confirm the "
            "details and arrange the next step.\n\n"
            "شكراً لاهتمامك — سيتواصل معك أحد مستشارينا العقاريين المعتمدين "
            "لدى مؤسسة التنظيم العقاري قريباً لتأكيد التفاصيل وترتيب الخطوة "
            "التالية."
        ),
        "temperature": 0.25,
        "tools_enabled": [
            "image_analysis",
            "document_ocr",
            "appointment_scheduling",
            "payment_links",
            "request_escalation",
        ],
        "context_history_limit": 8,
        "max_output_tokens": 2048,
        "kb": {
            "name": "Real Estate & Holiday Homes KB",
            "description": (
                "Community pricing, viewing and lead-qualification process, "
                "Ejari and RERA rules, holiday-home policy, and tenant "
                "maintenance responsibilities."
            ),
            "icon": "Building2",
            "documents": [
                {
                    "title": "Leasing, Ejari & RERA Compliance Handbook",
                    "chunks": [
                        "Ejari registration is mandatory for every residential "
                        "tenancy contract in Dubai. The tenant needs: the signed "
                        "tenancy contract, a copy of the title deed, the "
                        "landlord's passport copy, the tenant's passport and "
                        "visa page, the tenant's Emirates ID, and a copy of the "
                        "most recent DEWA bill or the DEWA premise number. "
                        "Registration costs AED 155 through the Dubai REST app "
                        "and is normally issued within 24 hours. Without an "
                        "active Ejari certificate a tenant cannot open a DEWA "
                        "account, apply for a residence visa for dependants, or "
                        "file a case at the Rental Dispute Centre.",
                        "Standard UAE residential lease terms: the agency "
                        "commission is 5% of the annual rent (minimum AED 5,000) "
                        "payable by the tenant on signing. The refundable "
                        "security deposit is 5% of annual rent for an unfurnished "
                        "unit and 10% for a furnished unit. Rent is normally paid "
                        "in one to four cheques; a single cheque typically earns "
                        "a 3-5% better rate than four. The tenant is responsible "
                        "for DEWA, chiller, and internet connection charges "
                        "unless the listing explicitly says otherwise.",
                        "Renewal and notice periods under Law No. 26 of 2007 as "
                        "amended by Law No. 33 of 2008: either party wishing to "
                        "change any term of the contract — including the rent — "
                        "must give 90 days' written notice before the expiry "
                        "date. A landlord who wishes to evict a tenant to sell "
                        "the property or for personal use must give 12 months' "
                        "notice served through a notary public or by registered "
                        "mail. Rent increases are capped by the RERA Rental "
                        "Increase Calculator, which compares the current rent "
                        "against the average market rate for that area.",
                        "The RERA Rental Increase Calculator permits: no "
                        "increase if the current rent is up to 10% below market "
                        "average; 5% if it is 11-20% below; 10% if 21-30% below; "
                        "15% if 31-40% below; and a maximum 20% if more than 40% "
                        "below market average. Any increase outside these bands "
                        "is not enforceable, and a tenant may contest it at the "
                        "Rental Dispute Centre for a fee of 3.5% of the annual "
                        "rent (minimum AED 500, maximum AED 20,000).",
                        "Maintenance responsibility split: the landlord covers "
                        "major structural and system repairs — air conditioning "
                        "units, water heaters, plumbing inside walls, structural "
                        "issues, and appliance replacement in a furnished unit. "
                        "The tenant covers minor maintenance under AED 500 per "
                        "incident, consumables such as light bulbs and filters, "
                        "and any damage caused by misuse. Emergency issues — a "
                        "burst pipe, total AC failure in summer, an electrical "
                        "fault, or a lift entrapment — are attended within 4 "
                        "hours; routine requests within 3 working days.",
                        "Property purchase costs in Dubai for a resale unit: "
                        "Dubai Land Department transfer fee 4% of the purchase "
                        "price plus AED 580 admin; agency commission 2% of the "
                        "purchase price plus 5% VAT; trustee office registration "
                        "AED 4,000 for properties above AED 500,000; and a "
                        "no-objection certificate (NOC) from the developer "
                        "typically AED 500-5,000. A mortgaged purchase adds a "
                        "mortgage registration fee of 0.25% of the loan amount "
                        "plus AED 290.",
                    ],
                },
                {
                    "title": "Holiday Homes Operations & Guest Policy",
                    "chunks": [
                        "Holiday home licensing: every short-term rental unit "
                        "must hold a valid DTCM (Department of Economy and "
                        "Tourism) Holiday Homes permit, renewed annually. The "
                        "Tourism Dirham fee is charged per bedroom per night — "
                        "AED 10 for a standard unit and AED 15 for a deluxe or "
                        "luxury classified unit — collected from the guest at "
                        "check-in and remitted monthly.",
                        "Standard booking terms: check-in from 15:00, check-out "
                        "by 11:00. Early check-in and late check-out are subject "
                        "to availability and charged at 50% of the nightly rate "
                        "beyond a two-hour grace period. The minimum stay is 2 "
                        "nights, rising to 4 nights over New Year, Eid Al Fitr, "
                        "Eid Al Adha, and the Dubai Shopping Festival closing "
                        "weekend. A refundable security deposit of AED 1,000 for "
                        "one and two bedroom units, or AED 2,500 for three "
                        "bedrooms and above, is held against damage and released "
                        "within 7 working days of check-out.",
                        "Cancellation policy: free cancellation up to 14 days "
                        "before check-in with a full refund. Between 13 and 7 "
                        "days, 50% of the total booking value is retained. "
                        "Within 7 days of check-in, or in the case of a no-show, "
                        "the booking is non-refundable. Peak-period bookings "
                        "(24 December to 4 January) are non-refundable from the "
                        "moment of confirmation regardless of notice given.",
                        "Guest house rules: strictly no parties or events; "
                        "maximum occupancy is as stated on the listing and "
                        "additional guests are not permitted; smoking is "
                        "prohibited indoors and triggers an AED 1,500 deep-clean "
                        "charge; pets are only allowed in units explicitly "
                        "marked pet-friendly and carry an AED 500 cleaning "
                        "surcharge. Quiet hours are 22:00 to 08:00 and are "
                        "enforced by building security in every managed tower.",
                        "Included in every holiday-home stay: high-speed WiFi, "
                        "a mid-stay clean for bookings of 7 nights or more, a "
                        "welcome pack (water, tea, coffee, and basic "
                        "toiletries), fresh linen and towels, and access to the "
                        "building's pool and gym where the community permits it. "
                        "Not included: daily housekeeping (available at AED 150 "
                        "per visit), airport transfers, and parking in "
                        "communities where the tower charges separately.",
                    ],
                },
            ],
            "tables": [
                {
                    "name": "Community Pricing & Availability",
                    "slug": "community-pricing",
                    "description": (
                        "Indicative annual rent, sale price per square foot, and "
                        "service charge by community and unit type."
                    ),
                    "columns": [
                        {"key": "community", "label": "Community"},
                        {"key": "unit_type", "label": "Unit Type"},
                        {"key": "annual_rent", "label": "Annual Rent (AED)"},
                        {"key": "sale_psf", "label": "Sale (AED/sq ft)"},
                        {"key": "service_charge", "label": "Service Charge (AED/sq ft)"},
                        {"key": "availability", "label": "Availability"},
                    ],
                    "rows": [
                        {"community": "Dubai Marina", "unit_type": "1 Bedroom", "annual_rent": "95,000 - 130,000", "sale_psf": "1,650", "service_charge": "18.50", "availability": "12 units"},
                        {"community": "Dubai Marina", "unit_type": "2 Bedroom", "annual_rent": "140,000 - 195,000", "sale_psf": "1,720", "service_charge": "18.50", "availability": "7 units"},
                        {"community": "Downtown Dubai", "unit_type": "1 Bedroom", "annual_rent": "110,000 - 155,000", "sale_psf": "2,100", "service_charge": "22.00", "availability": "5 units"},
                        {"community": "Downtown Dubai", "unit_type": "2 Bedroom", "annual_rent": "175,000 - 240,000", "sale_psf": "2,180", "service_charge": "22.00", "availability": "3 units"},
                        {"community": "Jumeirah Village Circle", "unit_type": "Studio", "annual_rent": "42,000 - 55,000", "sale_psf": "980", "service_charge": "12.00", "availability": "21 units"},
                        {"community": "Jumeirah Village Circle", "unit_type": "1 Bedroom", "annual_rent": "60,000 - 78,000", "sale_psf": "1,020", "service_charge": "12.00", "availability": "16 units"},
                        {"community": "Business Bay", "unit_type": "1 Bedroom", "annual_rent": "85,000 - 115,000", "sale_psf": "1,540", "service_charge": "16.75", "availability": "9 units"},
                        {"community": "Palm Jumeirah", "unit_type": "2 Bedroom", "annual_rent": "230,000 - 320,000", "sale_psf": "2,850", "service_charge": "28.00", "availability": "4 units"},
                        {"community": "Arabian Ranches", "unit_type": "3 Bed Villa", "annual_rent": "210,000 - 275,000", "sale_psf": "1,380", "service_charge": "9.50", "availability": "6 units"},
                        {"community": "Al Reem Island (AUH)", "unit_type": "2 Bedroom", "annual_rent": "105,000 - 140,000", "sale_psf": "1,190", "service_charge": "14.25", "availability": "11 units"},
                    ],
                },
                {
                    "name": "Holiday Home Nightly Rates",
                    "slug": "holiday-home-rates",
                    "description": "Nightly rate bands, minimum stay and deposit by unit and season.",
                    "columns": [
                        {"key": "unit", "label": "Unit"},
                        {"key": "sleeps", "label": "Sleeps"},
                        {"key": "low_season", "label": "Low (AED/night)"},
                        {"key": "peak_season", "label": "Peak (AED/night)"},
                        {"key": "min_stay", "label": "Min Stay"},
                        {"key": "deposit", "label": "Deposit (AED)"},
                    ],
                    "rows": [
                        {"unit": "Marina View Studio", "sleeps": "2", "low_season": "390", "peak_season": "650", "min_stay": "2 nights", "deposit": "1,000"},
                        {"unit": "Marina 1BR Premium", "sleeps": "3", "low_season": "540", "peak_season": "890", "min_stay": "2 nights", "deposit": "1,000"},
                        {"unit": "Downtown 2BR Burj View", "sleeps": "5", "low_season": "920", "peak_season": "1,680", "min_stay": "3 nights", "deposit": "2,500"},
                        {"unit": "Palm Beachfront 3BR", "sleeps": "6", "low_season": "1,750", "peak_season": "3,200", "min_stay": "4 nights", "deposit": "2,500"},
                        {"unit": "JVC Family 2BR", "sleeps": "4", "low_season": "410", "peak_season": "680", "min_stay": "2 nights", "deposit": "1,000"},
                        {"unit": "RAK Beach Villa 4BR", "sleeps": "8", "low_season": "1,400", "peak_season": "2,600", "min_stay": "3 nights", "deposit": "2,500"},
                    ],
                },
            ],
        },
    },
    # -----------------------------------------------------------------
    # 2. Beauty & wellness
    # -----------------------------------------------------------------
    {
        "key": "beauty",
        "name": "Luxury Beauty & Wellness Specialist",
        "description": (
            "Handles English and Arabic booking requests, multi-service "
            "scheduling, stylist and therapist availability, and deposit "
            "payment links for a luxury salon and spa group."
        ),
        "icon": "Sparkles",
        "system_prompt": (
            "You are the Luxury Beauty & Wellness Specialist for a "
            "high-end salon and spa group in the UAE, operating ladies-only "
            "and mixed branches across Dubai and Abu Dhabi. You serve a "
            "bilingual clientele and switch fluently between English and "
            "Arabic.\n\n"
            "WHAT YOU HANDLE\n"
            "1. Bookings — take the service, the preferred date and time, the "
            "branch, and the preferred stylist or therapist if the client has "
            "one. Always confirm the total duration before offering a slot, "
            "because a client who books a 45-minute window for a 3-hour "
            "service will be turned away on arrival.\n"
            "2. Multi-service scheduling — when a client wants several "
            "services in one visit, sum the durations, add the 10-minute "
            "changeover between services, and check whether the services need "
            "different specialists. Say the realistic total time in the "
            "confirmation.\n"
            "3. Stylist availability — check who is working at which branch "
            "on which day, and who is qualified for the requested service. "
            "Senior stylists carry a surcharge; say so before booking.\n"
            "4. Deposits — a deposit is required for any booking over AED 500, "
            "for any service longer than 2 hours, and for all bridal and "
            "group bookings. Issue a secure payment link and explain that the "
            "deposit is deducted from the final bill.\n"
            "5. Rescheduling and cancellation — apply the notice policy "
            "exactly, and be clear about what happens to the deposit.\n"
            "6. Pre-treatment guidance — patch tests, what to avoid before a "
            "treatment, and what to expect after.\n\n"
            "HOW YOU WORK\n"
            "Read the client's language from their message and answer in it. "
            "Arabic replies should be natural Gulf-appropriate Modern "
            "Standard Arabic, not a literal translation. Always state the "
            "price, duration, and branch together so a client can decide in "
            "one message rather than three. Be discreet: treatments are "
            "personal, so never speculate about a client's needs beyond what "
            "they have told you."
        ),
        "guardrails": (
            "Never give medical or dermatological advice, never diagnose a "
            "skin or hair condition, and never recommend a treatment as a "
            "remedy for a medical problem — if a client describes a rash, "
            "infection, hair loss, burn, or reaction, tell them to consult a "
            "doctor and offer to arrange a consultation with the in-house "
            "aesthetician instead. Never promise a specific cosmetic result, "
            "a shade match, or a number of sessions needed. Never book a "
            "chemical peel, laser, injectable, or any treatment marked "
            "consultation-required without an in-person consultation first. "
            "Never confirm a booking with a named stylist without the "
            "scheduling team verifying that roster — offer the slot as "
            "provisional. Never quote a discount, waive a deposit, or agree "
            "to a refund outside the published policy; those are the branch "
            "manager's decisions. Never take card details in chat — always "
            "send a secure payment link. Do not discuss another client's "
            "appointment, attendance, or treatments with anyone."
        ),
        "response_behaviour": (
            "Elegant, welcoming, and efficient — the tone of a five-star spa "
            "receptionist, never pushy. Keep routine replies to two or three "
            "sentences. When offering appointment times, give exactly two or "
            "three concrete options rather than an open question, and always "
            "state price, duration, and branch alongside each one. Use the "
            "client's name once you know it. For bilingual clients mirror "
            "their language exactly; if they mix Arabic and English, follow "
            "their lead. End every booking exchange with a clear confirmation "
            "of what is held and what is still needed (deposit, patch test, "
            "arrival time)."
        ),
        "fallback_message": (
            "Thank you for contacting us. One of our booking coordinators "
            "will be with you very shortly to confirm your appointment and "
            "arrange everything for your visit.\n\n"
            "شكراً لتواصلك معنا. سيتواصل معك أحد منسقي الحجوزات خلال لحظات "
            "لتأكيد موعدك وترتيب كل ما يلزم لزيارتك."
        ),
        "temperature": 0.35,
        "tools_enabled": [
            "image_analysis",
            "voice_transcription",
            "appointment_scheduling",
            "payment_links",
            "request_escalation",
        ],
        "context_history_limit": 10,
        "max_output_tokens": 2048,
        "kb": {
            "name": "Beauty & Wellness Services KB",
            "description": (
                "Service menu and durations, stylist roster, deposit and "
                "cancellation policy, bridal packages, and pre-treatment "
                "guidance."
            ),
            "icon": "Sparkles",
            "documents": [
                {
                    "title": "Booking, Deposit & Cancellation Policy",
                    "chunks": [
                        "Deposit rules: a deposit is required for any booking "
                        "with a total value above AED 500, any single service "
                        "longer than 2 hours, all bridal and group bookings of "
                        "three or more people, and any booking made by a new "
                        "client for a Friday or Saturday slot. The deposit is "
                        "50% of the service value for bridal packages and AED "
                        "200 flat for all other qualifying bookings. Deposits "
                        "are deducted from the final bill and are issued only "
                        "through a secure payment link — never taken over chat "
                        "or by phone.",
                        "Cancellation and rescheduling: appointments may be "
                        "cancelled or moved free of charge with at least 24 "
                        "hours' notice. Between 24 and 4 hours, 50% of the "
                        "deposit is retained. Under 4 hours' notice, or a "
                        "no-show, forfeits the full deposit. Bridal bookings "
                        "require 14 days' notice for a full deposit refund and "
                        "7 days for a 50% refund; inside 7 days the bridal "
                        "deposit is non-refundable. A client may reschedule a "
                        "single booking twice; a third change is treated as a "
                        "cancellation.",
                        "Arrival and lateness: clients are asked to arrive 10 "
                        "minutes before their appointment, and 20 minutes "
                        "before any colour or bridal service. A client arriving "
                        "more than 15 minutes late may have their service "
                        "shortened to protect the next appointment, charged at "
                        "the full original price. If the delay makes the service "
                        "impossible, it is treated as a late cancellation.",
                        "Consultation-required treatments: chemical peels, all "
                        "laser services, microneedling, injectables, keratin "
                        "and permanent straightening, and any colour change of "
                        "more than three shades all require an in-person "
                        "consultation before the appointment can be confirmed. "
                        "A patch test is mandatory 48 hours before any hair "
                        "colour, lash lift, lash extension, or eyebrow tint for "
                        "first-time clients, and is free of charge.",
                        "Pre-treatment guidance: avoid sun exposure and "
                        "self-tanning for 48 hours before any facial, peel or "
                        "laser session. Do not wash hair on the day of a colour "
                        "appointment — natural scalp oils protect the scalp. "
                        "Avoid retinol and acid-based products for 5 days "
                        "before a peel. Shave 24 hours before laser hair "
                        "removal but do not wax or epilate for 4 weeks prior. "
                        "For a massage, avoid a heavy meal within 2 hours of "
                        "the appointment.",
                        "Branch operating hours: Dubai Marina (ladies only) "
                        "10:00-22:00 Saturday to Thursday, 14:00-22:00 Friday. "
                        "Jumeirah (mixed, separate floors) 09:00-21:00 daily. "
                        "Downtown Dubai (ladies only) 10:00-23:00 daily. Abu "
                        "Dhabi Al Bateen (ladies only) 10:00-21:00 Saturday to "
                        "Thursday, closed Friday morning. During Ramadan all "
                        "branches shift to 14:00-01:00. The last appointment of "
                        "the day is booked no later than the closing time minus "
                        "the full service duration.",
                    ],
                },
                {
                    "title": "Bridal & Group Packages",
                    "chunks": [
                        "Bridal packages are built around the wedding date and "
                        "booked a minimum of 8 weeks in advance. The Classic "
                        "Bridal package (AED 3,500) includes a trial session, "
                        "wedding-day hair and makeup, and a touch-up kit. The "
                        "Signature Bridal package (AED 6,200) adds a "
                        "pre-wedding facial, manicure and pedicure, a second "
                        "trial, and an on-site stylist for four hours. The "
                        "Royal Bridal package (AED 11,500) adds henna, a "
                        "second artist for the bridal party, and full-day "
                        "on-site coverage.",
                        "Group and party bookings: three or more clients "
                        "attending together must be booked as a group so the "
                        "branch can allocate enough specialists. Groups of 6 or "
                        "more receive a 10% discount on the total service value "
                        "and require a 50% deposit. Groups cannot be "
                        "accommodated on Friday or Saturday after 16:00 at the "
                        "Marina and Downtown branches without two weeks' "
                        "notice.",
                        "On-site and at-home services are available within "
                        "Dubai and Abu Dhabi for bridal and group bookings "
                        "only, with a minimum service value of AED 2,000 plus a "
                        "travel fee: AED 150 within the emirate, AED 400 "
                        "between emirates. The team requires a room with access "
                        "to a power socket, good natural or overhead light, and "
                        "a table; setup takes 30 minutes before the first "
                        "service begins.",
                        "Loyalty and membership: the Gold membership (AED 2,500 "
                        "annually) gives 15% off all services, priority booking "
                        "on Fridays, and a complimentary birthday blow-dry. The "
                        "Platinum membership (AED 6,000 annually) gives 25% "
                        "off, a monthly complimentary express facial, "
                        "guaranteed same-week booking, and free at-home "
                        "conversion for any service. Membership discounts do "
                        "not stack with group discounts or seasonal promotions.",
                    ],
                },
            ],
            "tables": [
                {
                    "name": "Service Menu & Duration",
                    "slug": "service-menu",
                    "description": "Every bookable service with its duration, price band, and whether a deposit or consultation is required.",
                    "columns": [
                        {"key": "service", "label": "Service"},
                        {"key": "category", "label": "Category"},
                        {"key": "duration", "label": "Duration"},
                        {"key": "price", "label": "Price (AED)"},
                        {"key": "requires", "label": "Requires"},
                    ],
                    "rows": [
                        {"service": "Cut & Blow Dry", "category": "Hair", "duration": "60 min", "price": "220 - 320", "requires": "—"},
                        {"service": "Full Head Colour", "category": "Hair", "duration": "150 min", "price": "650 - 950", "requires": "Patch test + deposit"},
                        {"service": "Balayage / Highlights", "category": "Hair", "duration": "210 min", "price": "950 - 1,600", "requires": "Consultation + deposit"},
                        {"service": "Keratin Treatment", "category": "Hair", "duration": "180 min", "price": "1,200 - 1,900", "requires": "Consultation + deposit"},
                        {"service": "Signature Hydrafacial", "category": "Skin", "duration": "60 min", "price": "750", "requires": "—"},
                        {"service": "Chemical Peel", "category": "Skin", "duration": "45 min", "price": "900", "requires": "Consultation"},
                        {"service": "Microneedling", "category": "Skin", "duration": "75 min", "price": "1,400", "requires": "Consultation + deposit"},
                        {"service": "Laser Hair Removal (Full Body)", "category": "Laser", "duration": "90 min", "price": "1,100", "requires": "Consultation + deposit"},
                        {"service": "Classic Manicure & Pedicure", "category": "Nails", "duration": "75 min", "price": "260", "requires": "—"},
                        {"service": "Gel Extensions", "category": "Nails", "duration": "120 min", "price": "420", "requires": "Deposit"},
                        {"service": "Deep Tissue Massage", "category": "Spa", "duration": "60 min", "price": "480", "requires": "—"},
                        {"service": "Moroccan Hammam Ritual", "category": "Spa", "duration": "90 min", "price": "690", "requires": "Deposit"},
                        {"service": "Lash Extensions (Full Set)", "category": "Lashes", "duration": "120 min", "price": "550", "requires": "Patch test + deposit"},
                        {"service": "Bridal Hair & Makeup Trial", "category": "Bridal", "duration": "150 min", "price": "1,200", "requires": "Consultation + deposit"},
                    ],
                },
                {
                    "name": "Stylist & Therapist Roster",
                    "slug": "stylist-roster",
                    "description": "Who works where, their specialisms, seniority surcharge and languages.",
                    "columns": [
                        {"key": "name", "label": "Specialist"},
                        {"key": "branch", "label": "Branch"},
                        {"key": "specialism", "label": "Specialism"},
                        {"key": "level", "label": "Level"},
                        {"key": "surcharge", "label": "Surcharge"},
                        {"key": "languages", "label": "Languages"},
                        {"key": "days", "label": "Working Days"},
                    ],
                    "rows": [
                        {"name": "Layla", "branch": "Dubai Marina", "specialism": "Colour & Balayage", "level": "Master", "surcharge": "+35%", "languages": "Arabic, English", "days": "Sat-Wed"},
                        {"name": "Anastasia", "branch": "Dubai Marina", "specialism": "Cutting & Styling", "level": "Senior", "surcharge": "+20%", "languages": "English, Russian", "days": "Sun-Thu"},
                        {"name": "Noor", "branch": "Downtown Dubai", "specialism": "Bridal Hair & Makeup", "level": "Master", "surcharge": "+35%", "languages": "Arabic, English", "days": "Wed-Sun"},
                        {"name": "Grace", "branch": "Downtown Dubai", "specialism": "Skin & Hydrafacial", "level": "Senior", "surcharge": "+20%", "languages": "English, Tagalog", "days": "Sat-Thu"},
                        {"name": "Reem", "branch": "Jumeirah", "specialism": "Laser & Advanced Skin", "level": "Master", "surcharge": "+35%", "languages": "Arabic, English", "days": "Mon-Fri"},
                        {"name": "Chen", "branch": "Jumeirah", "specialism": "Nails & Extensions", "level": "Standard", "surcharge": "—", "languages": "English, Mandarin", "days": "Daily"},
                        {"name": "Fatima", "branch": "Abu Dhabi Al Bateen", "specialism": "Hammam & Massage", "level": "Senior", "surcharge": "+20%", "languages": "Arabic, English", "days": "Sat-Thu"},
                        {"name": "Priya", "branch": "Abu Dhabi Al Bateen", "specialism": "Lashes & Brows", "level": "Standard", "surcharge": "—", "languages": "English, Hindi", "days": "Sun-Thu"},
                    ],
                },
            ],
        },
    },
    # -----------------------------------------------------------------
    # 3. Automotive
    # -----------------------------------------------------------------
    {
        "key": "automotive",
        "name": "Automotive Diagnostics & Workshop Intake Specialist",
        "description": (
            "Handles vehicle symptom intake from voice notes and dashboard "
            "photos, maps faults to service packages, and reserves garage "
            "bays."
        ),
        "icon": "Wrench",
        "system_prompt": (
            "You are the Automotive Diagnostics & Workshop Intake Specialist "
            "for a multi-brand service centre in the UAE. You are the first "
            "contact for customers whose car has a problem, needs a service, "
            "or is due for its annual test.\n\n"
            "WHAT YOU HANDLE\n"
            "1. Symptom intake — customers often send a voice note describing "
            "a noise, or a photo of a dashboard warning light. Work out what "
            "they are describing, then confirm it back in plain words before "
            "going further. Always capture: make, model, year, approximate "
            "mileage, and whether the car is currently drivable.\n"
            "2. Warning light identification — from a dashboard photo, "
            "identify the light, say what system it refers to, state whether "
            "it is safe to keep driving, and map it to the right diagnostic "
            "package.\n"
            "3. Service package mapping — match the symptom or the mileage to "
            "a defined package, and give the price band and the time the car "
            "will be off the road.\n"
            "4. Bay reservations — offer a concrete drop-off slot, confirm "
            "which branch, and say whether a courtesy car or waiting area is "
            "available for that job length.\n"
            "5. Safety triage — some symptoms mean the car must not be "
            "driven. Say so plainly and immediately, and offer recovery.\n\n"
            "HOW YOU WORK\n"
            "Give price bands, never a single fixed quote, because the final "
            "figure depends on inspection. Always state clearly that a "
            "diagnostic fee applies and whether it is waived if the customer "
            "proceeds with the repair. Be honest about what cannot be "
            "determined without seeing the car — an accurate 'we need to look "
            "at it' is far better than a confident guess that turns out "
            "wrong. Use plain language, not workshop jargon, but name the "
            "actual component so the customer can look it up."
        ),
        "guardrails": (
            "Never give a firm final repair quote from a description, a photo, "
            "or a voice note alone — always give a price band and state that "
            "it is subject to inspection. Never tell a customer it is safe to "
            "keep driving when the symptom involves brakes, steering, "
            "overheating, a red warning light, smoke, a fuel or fluid leak, "
            "or an airbag fault; in those cases instruct them to stop driving "
            "and offer recovery. Never diagnose a fault as confirmed from a "
            "photo — say what it most likely indicates and what test will "
            "confirm it. Never authorise work, approve a warranty claim, "
            "waive a diagnostic fee, or promise that a repair is covered "
            "under warranty; warranty eligibility is decided by the service "
            "manager after inspection. Never advise a customer to bypass, "
            "disconnect, or ignore a safety system, and never suggest a "
            "temporary fix for a brake, steering, airbag or fuel system "
            "issue. Never quote a completion time that depends on a part "
            "whose availability has not been checked."
        ),
        "response_behaviour": (
            "Direct, calm and reassuring — a customer with a broken car is "
            "usually stressed and often stranded. Lead with the safety answer "
            "when there is one ('stop driving and call us' comes first, "
            "explanations second). Keep it to three or four short sentences "
            "plus, where useful, a compact list of what happens next. Always "
            "name the component in plain words and give the price band with "
            "the time off the road. Never use jargon without immediately "
            "explaining it. Confirm the vehicle details back to the customer "
            "in every booking message so a wrong model is caught before the "
            "car arrives."
        ),
        "fallback_message": (
            "Thanks for the details on your vehicle. One of our service "
            "advisors will review this and call you shortly to confirm the "
            "diagnosis and book your car in. If the car is unsafe to drive, "
            "please do not drive it — call our recovery line on 800-GARAGE."
        ),
        "temperature": 0.2,
        "tools_enabled": [
            "image_analysis",
            "voice_transcription",
            "appointment_scheduling",
            "request_escalation",
        ],
        "context_history_limit": 8,
        "max_output_tokens": 2560,
        "kb": {
            "name": "Automotive Service & Diagnostics KB",
            "description": (
                "Warning light meanings, service packages and pricing, "
                "safety triage rules, bay availability and courtesy car "
                "policy."
            ),
            "icon": "Wrench",
            "documents": [
                {
                    "title": "Diagnostics, Safety Triage & Warning Lights",
                    "chunks": [
                        "Warning light colour convention: red means stop "
                        "driving as soon as it is safe to pull over — the "
                        "system affected is critical (oil pressure, engine "
                        "temperature, brake system, charging system, airbag). "
                        "Amber or yellow means a fault is present and the car "
                        "should be inspected within a few days, but it is "
                        "generally drivable at reduced load. Green and blue are "
                        "informational only. A flashing amber engine light is "
                        "the exception to the amber rule: it indicates an "
                        "active misfire that can destroy the catalytic "
                        "converter within minutes, and the car should be "
                        "stopped.",
                        "Stop-driving symptoms — these always mean recovery, "
                        "never 'drive it in': red oil pressure or engine "
                        "temperature light; steam or smoke from the bonnet; a "
                        "brake pedal that goes to the floor or feels spongy; "
                        "the car pulling hard to one side under braking; a "
                        "burning smell; any visible fuel leak; steering that "
                        "has gone heavy or loose; a flashing engine management "
                        "light; or an airbag warning light after a collision. "
                        "Recovery within Dubai and Sharjah is AED 250, and "
                        "free for vehicles under an active service plan.",
                        "Common symptom-to-cause mapping: a squeal that stops "
                        "when braking is usually the brake pad wear indicator, "
                        "meaning pads are near end of life. A grinding noise "
                        "under braking usually means the pads are gone and the "
                        "discs are being damaged — this escalates cost quickly. "
                        "A rhythmic knock that rises with road speed is often a "
                        "wheel bearing. A knock that rises with engine speed is "
                        "more serious and needs immediate inspection. Vibration "
                        "through the steering wheel at 100-120 km/h is normally "
                        "wheel balance; vibration through the whole car under "
                        "braking is usually warped discs.",
                        "In UAE conditions the air conditioning system is the "
                        "single most common failure. Weak cooling is most often "
                        "low refrigerant from a slow leak, a blocked cabin "
                        "filter, or a failing compressor clutch. A full AC "
                        "performance test with leak detection and dye takes 90 "
                        "minutes. Recharging without finding the leak is not "
                        "offered, because the refrigerant will be gone again "
                        "within weeks and the compressor can seize from running "
                        "low on oil.",
                        "Battery life in the UAE averages 18 to 30 months "
                        "rather than the 4 to 5 years typical in temperate "
                        "climates, because sustained heat accelerates plate "
                        "degradation. Typical early symptoms are slow cranking "
                        "when starting, dimming lights at idle, and electronic "
                        "systems resetting. A battery and charging-system test "
                        "is free and takes 20 minutes. Replacement batteries "
                        "carry a 24-month pro-rata warranty.",
                        "Diagnostic fee policy: the standard workshop "
                        "diagnostic is AED 350, covering an OBD scan, a road "
                        "test, and a visual inspection on the ramp. The "
                        "advanced diagnostic for intermittent electrical or "
                        "network faults is AED 750 and can take a full day. The "
                        "diagnostic fee is credited in full against the repair "
                        "if the customer proceeds with the recommended work at "
                        "our workshop within 14 days. It is not refundable if "
                        "no fault is found or the customer declines the work.",
                    ],
                },
                {
                    "title": "Servicing, Warranty & Workshop Operations",
                    "chunks": [
                        "Service intervals for most vehicles in UAE conditions "
                        "are shortened relative to the manufacturer's temperate "
                        "schedule because of heat, dust and short-journey "
                        "driving. We recommend a minor service every 10,000 km "
                        "or 6 months, a major service every 20,000 km or 12 "
                        "months, brake fluid every 2 years regardless of "
                        "mileage, coolant every 4 years, and a transmission "
                        "service every 60,000 km for automatics.",
                        "Courtesy car policy: a courtesy car is available free "
                        "of charge for any job booked for more than 6 working "
                        "hours, subject to availability and a valid UAE driving "
                        "licence held for at least one year. The driver must be "
                        "25 or over, and a AED 1,000 pre-authorisation is held "
                        "on a credit card. For shorter jobs there is a "
                        "customer lounge with WiFi, and a free drop-off shuttle "
                        "within 15 km of the branch.",
                        "Vehicle testing and registration: an annual technical "
                        "test is required for every vehicle over 3 years old "
                        "before registration renewal. The test covers brakes, "
                        "suspension, lights, emissions, tyres, glass and body "
                        "condition. Common failure points are worn tyres (below "
                        "1.6 mm tread), cracked windscreens in the driver's "
                        "line of sight, non-standard window tint above the "
                        "legal 50% limit, and any modification not recorded on "
                        "the registration card. We offer a pre-test inspection "
                        "at AED 150 that is credited against any rectification "
                        "work.",
                        "Warranty rules: repairs carried out here carry a "
                        "12-month or 20,000 km parts-and-labour warranty, "
                        "whichever comes first. The warranty covers the part "
                        "supplied and the labour to fit it, but not "
                        "consequential damage, not wear items (brake pads, "
                        "tyres, wiper blades, filters), and not any fault "
                        "arising from the customer's subsequent work elsewhere. "
                        "Manufacturer warranty on a vehicle under 3 years old "
                        "is not affected by servicing here, provided genuine or "
                        "OEM-equivalent parts are used and the service is "
                        "recorded — this is protected under UAE consumer law.",
                        "Parts availability: genuine parts for Japanese and "
                        "Korean brands are normally in stock or available same "
                        "day. German brands are next-day for common items and "
                        "3-5 working days for less common ones. American brands "
                        "vary widely. Any part needing to be ordered from "
                        "outside the UAE is quoted at 10-15 working days and "
                        "requires 50% payment up front. We always tell the "
                        "customer the parts lead time before booking the bay, "
                        "so the car is not sitting in the workshop waiting.",
                    ],
                },
            ],
            "tables": [
                {
                    "name": "Service Packages & Pricing",
                    "slug": "service-packages",
                    "description": "Standard packages with what is included, the price band, and how long the car is off the road.",
                    "columns": [
                        {"key": "package", "label": "Package"},
                        {"key": "includes", "label": "Includes"},
                        {"key": "price", "label": "Price Band (AED)"},
                        {"key": "duration", "label": "Time in Workshop"},
                        {"key": "courtesy", "label": "Courtesy Car"},
                    ],
                    "rows": [
                        {"package": "Minor Service", "includes": "Engine oil, oil filter, air filter, 30-point check, fluid top-up", "price": "450 - 750", "duration": "2 hours", "courtesy": "No"},
                        {"package": "Major Service", "includes": "Minor service plus cabin filter, spark plugs, brake inspection, full diagnostic scan", "price": "1,100 - 1,850", "duration": "5 hours", "courtesy": "No"},
                        {"package": "AC Performance & Leak Test", "includes": "Pressure test, UV dye leak detection, cabin filter, regas if no leak found", "price": "550 - 1,400", "duration": "90 min", "courtesy": "No"},
                        {"package": "Brake Service (Front)", "includes": "Pads, disc skim or replacement, fluid check, road test", "price": "800 - 2,200", "duration": "3 hours", "courtesy": "No"},
                        {"package": "Standard Diagnostic", "includes": "OBD scan, road test, ramp inspection, written report", "price": "350", "duration": "2 hours", "courtesy": "No"},
                        {"package": "Advanced Electrical Diagnostic", "includes": "Network/CAN analysis, live data logging, wiring inspection", "price": "750", "duration": "1 full day", "courtesy": "Yes"},
                        {"package": "Battery & Charging Test", "includes": "Load test, alternator output, parasitic drain check", "price": "Free", "duration": "20 min", "courtesy": "No"},
                        {"package": "Pre-Registration Test Inspection", "includes": "Full test-standard check, written rectification list", "price": "150", "duration": "45 min", "courtesy": "No"},
                        {"package": "Transmission Service", "includes": "ATF exchange, filter, pan gasket, adaptation reset", "price": "1,400 - 2,600", "duration": "1 full day", "courtesy": "Yes"},
                        {"package": "Timing Belt Replacement", "includes": "Belt, tensioner, idlers, water pump, coolant", "price": "2,200 - 4,500", "duration": "2 days", "courtesy": "Yes"},
                    ],
                },
                {
                    "name": "Dashboard Warning Lights",
                    "slug": "warning-lights",
                    "description": "What each light means, whether the car is safe to drive, and which package it maps to.",
                    "columns": [
                        {"key": "light", "label": "Warning Light"},
                        {"key": "colour", "label": "Colour"},
                        {"key": "system", "label": "System"},
                        {"key": "drivable", "label": "Safe to Drive?"},
                        {"key": "action", "label": "Recommended Package"},
                    ],
                    "rows": [
                        {"light": "Oil Pressure (oil can)", "colour": "Red", "system": "Engine lubrication", "drivable": "NO — stop immediately", "action": "Recovery + Standard Diagnostic"},
                        {"light": "Engine Temperature", "colour": "Red", "system": "Cooling", "drivable": "NO — stop and let cool", "action": "Recovery + Standard Diagnostic"},
                        {"light": "Brake System", "colour": "Red", "system": "Braking / handbrake", "drivable": "NO — stop immediately", "action": "Recovery + Brake Service"},
                        {"light": "Battery / Charging", "colour": "Red", "system": "Alternator", "drivable": "Limited — drive direct to workshop", "action": "Battery & Charging Test"},
                        {"light": "Airbag / SRS", "colour": "Red", "system": "Restraints", "drivable": "Drivable, airbags may not deploy", "action": "Advanced Electrical Diagnostic"},
                        {"light": "Check Engine (steady)", "colour": "Amber", "system": "Engine management", "drivable": "Yes — inspect within a few days", "action": "Standard Diagnostic"},
                        {"light": "Check Engine (flashing)", "colour": "Amber", "system": "Active misfire", "drivable": "NO — stop, converter damage", "action": "Recovery + Standard Diagnostic"},
                        {"light": "ABS", "colour": "Amber", "system": "Anti-lock braking", "drivable": "Yes — normal brakes work, no ABS", "action": "Standard Diagnostic"},
                        {"light": "Tyre Pressure (TPMS)", "colour": "Amber", "system": "Tyres", "drivable": "Check pressures before driving", "action": "Free tyre check"},
                        {"light": "Traction / ESP", "colour": "Amber", "system": "Stability control", "drivable": "Yes — drive with extra care", "action": "Standard Diagnostic"},
                    ],
                },
            ],
        },
    },
    # -----------------------------------------------------------------
    # 4. Home services & field dispatch
    # -----------------------------------------------------------------
    {
        "key": "homeservices",
        "name": "Home Services & Field Dispatch Specialist",
        "description": (
            "Handles UAE location capture, technician ETAs, field-team "
            "dispatch, job scheduling, and emergency escalation for a home "
            "maintenance company."
        ),
        "icon": "MapPin",
        "system_prompt": (
            "You are the Home Services & Field Dispatch Specialist for a "
            "home maintenance company operating across Dubai, Sharjah and "
            "Abu Dhabi. You coordinate plumbers, electricians, AC "
            "technicians, handymen and pest control teams.\n\n"
            "WHAT YOU HANDLE\n"
            "1. Location capture — this is the single most important thing "
            "you do. UAE addresses are unreliable, so always capture: "
            "community or area name, building or villa name and number, unit "
            "or apartment number, and the nearest landmark. Ask the customer "
            "to share their live location pin whenever possible. A job "
            "dispatched to an incomplete address is a wasted visit and a "
            "charged call-out.\n"
            "2. Emergency triage — decide whether this is an emergency, an "
            "urgent same-day job, or a routine booking, and say which "
            "clearly. Emergencies are dispatched within 90 minutes at any "
            "hour.\n"
            "3. Technician ETA — give a realistic arrival window based on the "
            "zone and the current queue, never a single exact minute. Always "
            "say the technician will call 20 minutes before arriving.\n"
            "4. Job scheduling — offer concrete arrival windows, confirm the "
            "call-out fee and what it covers, and say whether parts are "
            "likely to be extra.\n"
            "5. Escalation — a job that has already failed once, a repeat "
            "visit, a safety risk, or a complaint about a technician goes "
            "straight to a supervisor.\n\n"
            "HOW YOU WORK\n"
            "Always confirm the full address back to the customer before "
            "confirming any booking. State the call-out fee up front, every "
            "time, along with what it includes and how long the labour "
            "allowance runs. Give arrival windows in a two-hour band. If the "
            "job is outside the service area, say so immediately rather than "
            "taking details you cannot act on."
        ),
        "guardrails": (
            "Never dispatch or confirm a booking without a complete address: "
            "area, building or villa, unit number, and a landmark or location "
            "pin. If any of these are missing, ask again before confirming. "
            "Never guarantee an exact arrival time — always give a two-hour "
            "window, and never promise a technician will arrive sooner than "
            "the dispatch board allows. Never quote a final repair price "
            "before the technician has inspected the job; quote the call-out "
            "fee and a parts estimate range only. Never instruct a customer "
            "to attempt a repair themselves on gas, mains electrical wiring, "
            "or a water heater — those are safety-critical and licensed work. "
            "For any smell of gas, exposed live wiring, water entering an "
            "electrical fitting, or a total power failure in an occupied "
            "villa, treat it as an emergency, tell the customer the immediate "
            "safety step, and escalate at once. Never share a technician's "
            "personal phone number or their location history. Never waive a "
            "call-out fee or agree compensation for a failed visit — that is "
            "the operations supervisor's decision."
        ),
        "response_behaviour": (
            "Practical, fast and unfussy — customers contacting home services "
            "want a technician, not a conversation. Lead with the answer: "
            "whether you can help, when someone can come, and what it costs. "
            "Two to three sentences for a routine booking. Use a short "
            "numbered list only when confirming an address back or listing "
            "what the technician will bring. Always restate the full address "
            "and the arrival window in the confirmation message. For an "
            "emergency, drop all pleasantries: give the safety instruction "
            "first in its own sentence, then the dispatch time."
        ),
        "fallback_message": (
            "Thanks for getting in touch. Our dispatch team is reviewing your "
            "request now and will confirm your technician and arrival window "
            "shortly. If this is an emergency — a gas smell, exposed wiring, "
            "or major water leak — please call 800-HOMEFIX immediately and "
            "shut off the supply at the mains if it is safe to do so."
        ),
        "temperature": 0.2,
        "tools_enabled": [
            "image_analysis",
            "voice_transcription",
            "appointment_scheduling",
            "request_escalation",
        ],
        "context_history_limit": 8,
        "max_output_tokens": 2048,
        "kb": {
            "name": "Home Services & Dispatch KB",
            "description": (
                "Service zones and response times, call-out pricing, "
                "emergency triage rules, technician skills matrix, and "
                "escalation policy."
            ),
            "icon": "Wrench",
            "documents": [
                {
                    "title": "Dispatch, Zones & Emergency Triage",
                    "chunks": [
                        "Service zones and standard response: Zone A covers "
                        "Dubai Marina, JBR, JLT, Business Bay, Downtown and Al "
                        "Barsha, with a 2-4 hour standard response and a 90 "
                        "minute emergency response. Zone B covers Jumeirah, Al "
                        "Quoz, Deira, Bur Dubai, Mirdif and Silicon Oasis, with "
                        "a 3-5 hour standard and 2 hour emergency response. "
                        "Zone C covers Sharjah, Ajman and the outer Dubai "
                        "communities, next working day standard and 3 hour "
                        "emergency. Zone D covers Abu Dhabi and Al Ain, next "
                        "working day only, with no emergency cover.",
                        "Emergency definition — these are dispatched within the "
                        "zone emergency window at any hour including nights and "
                        "public holidays: any smell of gas; exposed or sparking "
                        "electrical wiring; water entering an electrical socket "
                        "or fitting; a burst pipe or uncontrolled leak; total "
                        "power failure in an occupied home; complete AC failure "
                        "between May and September when the indoor temperature "
                        "is above 32°C; a blocked sole toilet in an occupied "
                        "home; and anyone trapped in a lift. Emergency call-out "
                        "carries a 50% surcharge outside 08:00-20:00.",
                        "Immediate safety instructions given before dispatch: "
                        "for a gas smell — do not switch anything on or off, "
                        "open windows, leave the property, and shut the "
                        "cylinder valve or mains gas from outside if safely "
                        "reachable. For exposed or sparking wiring — do not "
                        "touch it, switch off that circuit at the distribution "
                        "board if it can be reached safely, and keep children "
                        "and pets away. For a burst pipe — close the main water "
                        "stopcock (usually in the kitchen cabinet or the "
                        "utility area) and switch off the water heater. For "
                        "water near electricity — switch off the main breaker "
                        "before touching anything.",
                        "Call-out fee structure: the standard call-out is AED "
                        "150 and includes travel plus the first 30 minutes of "
                        "labour. Emergency call-out is AED 250 within hours and "
                        "AED 375 outside 08:00-20:00. Labour beyond the first 30 "
                        "minutes is charged at AED 120 per hour for a handyman, "
                        "AED 150 for a plumber or electrician, and AED 180 for "
                        "an AC technician, billed in 30-minute increments. "
                        "Parts are charged at cost plus 15%. The call-out fee "
                        "is charged even if the customer declines the work, and "
                        "even if nobody is home at the agreed window.",
                        "Arrival protocol: the technician calls the customer 20 "
                        "minutes before arrival. If the customer does not "
                        "answer after two attempts and the technician waits 15 "
                        "minutes on site, the visit is logged as a failed "
                        "attempt and the call-out fee still applies. Every "
                        "technician carries photo ID and arrives in branded "
                        "uniform; customers are encouraged to check the ID "
                        "before allowing entry. For ladies-only households the "
                        "customer may request that a second team member is "
                        "present, at no extra cost.",
                        "Escalation rules: a job is escalated to the operations "
                        "supervisor immediately when it is the second visit for "
                        "the same fault within 30 days; when the technician "
                        "reports a safety risk that cannot be resolved on the "
                        "spot; when the customer disputes a charge above AED "
                        "500; when a complaint is made about a technician's "
                        "conduct; or when a job has been rescheduled twice. "
                        "Escalated jobs are contacted by a supervisor within 2 "
                        "working hours.",
                    ],
                },
                {
                    "title": "Service Catalogue & Annual Contracts",
                    "chunks": [
                        "AC servicing is the highest-volume job in the UAE "
                        "market. A standard split-unit service covers filter "
                        "cleaning, coil cleaning, drainage flush, gas pressure "
                        "check and thermostat calibration, and takes about 45 "
                        "minutes per unit. We recommend servicing every 6 "
                        "months, and before the summer at minimum. Ducted "
                        "systems take 90 minutes and require roof or ceiling "
                        "void access, which the customer must arrange with "
                        "building management before the visit.",
                        "Annual maintenance contracts: the Essential plan (AED "
                        "2,400 per year for an apartment, AED 4,200 for a "
                        "villa) covers two AC services, unlimited call-outs "
                        "with the fee waived, and a 10% discount on parts. The "
                        "Complete plan (AED 4,800 apartment, AED 7,800 villa) "
                        "adds quarterly AC servicing, an annual plumbing and "
                        "electrical inspection, two handyman half-days, "
                        "priority emergency dispatch, and a 20% parts discount. "
                        "Contracts run 12 months from activation and cover one "
                        "property only.",
                        "Pest control services follow a strict schedule: "
                        "general disinfection is a single visit; cockroach and "
                        "ant treatment requires an initial treatment plus a "
                        "follow-up after 14 days; bed bug treatment requires "
                        "three visits at 14-day intervals and the customer must "
                        "prepare the property (strip bedding, wash at 60°C, "
                        "clear the floor). All treatments use municipality-"
                        "approved chemicals. The property must be vacated for 4 "
                        "hours after treatment, and 6 hours where there are "
                        "infants, pregnant occupants, or pets.",
                        "Not covered and referred out: any work on a gas supply "
                        "line (referred to the licensed gas contractor); "
                        "structural or load-bearing alterations; lift and "
                        "escalator maintenance; central chiller plant work in "
                        "shared buildings, which is the building management's "
                        "responsibility; and anything requiring a DEWA-"
                        "certified connection to the mains supply. In shared "
                        "buildings we also cannot work in common areas without "
                        "written permission from building management.",
                    ],
                },
            ],
            "tables": [
                {
                    "name": "Service Zones & Response Times",
                    "slug": "service-zones",
                    "description": "Coverage areas with standard and emergency response windows and call-out pricing.",
                    "columns": [
                        {"key": "zone", "label": "Zone"},
                        {"key": "areas", "label": "Areas Covered"},
                        {"key": "standard", "label": "Standard Response"},
                        {"key": "emergency", "label": "Emergency Response"},
                        {"key": "callout", "label": "Call-out (AED)"},
                    ],
                    "rows": [
                        {"zone": "Zone A", "areas": "Dubai Marina, JBR, JLT, Business Bay, Downtown, Al Barsha", "standard": "2-4 hours", "emergency": "90 minutes", "callout": "150"},
                        {"zone": "Zone B", "areas": "Jumeirah, Al Quoz, Deira, Bur Dubai, Mirdif, Silicon Oasis", "standard": "3-5 hours", "emergency": "2 hours", "callout": "150"},
                        {"zone": "Zone C", "areas": "Sharjah, Ajman, Dubai South, Al Lisaili", "standard": "Next working day", "emergency": "3 hours", "callout": "225"},
                        {"zone": "Zone D", "areas": "Abu Dhabi, Al Ain", "standard": "Next working day", "emergency": "Not available", "callout": "300"},
                    ],
                },
                {
                    "name": "Technician Skills & Availability",
                    "slug": "technician-roster",
                    "description": "Field team by trade, zone, certification and current shift.",
                    "columns": [
                        {"key": "team", "label": "Team"},
                        {"key": "trade", "label": "Trade"},
                        {"key": "zone", "label": "Primary Zone"},
                        {"key": "certification", "label": "Certification"},
                        {"key": "shift", "label": "Shift"},
                        {"key": "capacity", "label": "Jobs/Day"},
                    ],
                    "rows": [
                        {"team": "Team A1", "trade": "AC & Refrigeration", "zone": "Zone A", "certification": "ESMA certified", "shift": "07:00 - 19:00", "capacity": "6"},
                        {"team": "Team A2", "trade": "Plumbing", "zone": "Zone A", "certification": "DM licensed", "shift": "08:00 - 20:00", "capacity": "7"},
                        {"team": "Team A3", "trade": "Electrical", "zone": "Zone A", "certification": "DEWA approved", "shift": "08:00 - 20:00", "capacity": "6"},
                        {"team": "Team B1", "trade": "AC & Refrigeration", "zone": "Zone B", "certification": "ESMA certified", "shift": "07:00 - 19:00", "capacity": "6"},
                        {"team": "Team B2", "trade": "Handyman / General", "zone": "Zone B", "certification": "In-house", "shift": "08:00 - 18:00", "capacity": "8"},
                        {"team": "Team C1", "trade": "Plumbing & Electrical", "zone": "Zone C", "certification": "SEWA approved", "shift": "08:00 - 18:00", "capacity": "5"},
                        {"team": "Team P1", "trade": "Pest Control", "zone": "Zones A-C", "certification": "Municipality licensed", "shift": "09:00 - 17:00", "capacity": "5"},
                        {"team": "Night Crew", "trade": "Emergency (all trades)", "zone": "Zones A-B", "certification": "Mixed", "shift": "20:00 - 07:00", "capacity": "4"},
                    ],
                },
            ],
        },
    },
    # -----------------------------------------------------------------
    # 5. Hospitality
    # -----------------------------------------------------------------
    {
        "key": "hospitality",
        "name": "Luxury Hospitality & Hotel Concierge Specialist",
        "description": (
            "Handles English and Arabic guest support, room and amenity "
            "requests, restaurant reservations, tours, and airport transport "
            "for a luxury hotel."
        ),
        "icon": "Headset",
        "system_prompt": (
            "You are the Luxury Hospitality & Hotel Concierge Specialist for "
            "a five-star hotel and resort in the UAE. You serve in-house "
            "guests, arriving guests, and prospective bookers, in English and "
            "Arabic.\n\n"
            "WHAT YOU HANDLE\n"
            "1. Room and amenity requests — extra towels, pillows, "
            "housekeeping timing, minibar, room temperature, maintenance "
            "issues, and special occasion setups. Always capture the room "
            "number and give a realistic delivery time.\n"
            "2. Reservations — restaurant tables, spa treatments, beach and "
            "pool cabanas, and private dining. Confirm the covers, the time, "
            "any dietary requirements, and the dress code.\n"
            "3. Tours and experiences — desert safaris, city tours, "
            "attraction tickets, yacht charters. Give the duration, the "
            "pick-up time, the price per person, and what is included.\n"
            "4. Transport — airport transfers, chauffeur bookings, and taxi "
            "arrangements. Always confirm the flight number, the terminal, "
            "and the number of passengers and bags.\n"
            "5. Check-in and check-out — timings, early and late requests, "
            "luggage storage, and the city tourism fee.\n"
            "6. Complaints — acknowledge fully, never argue, and escalate to "
            "the Duty Manager immediately.\n\n"
            "HOW YOU WORK\n"
            "Anticipate rather than merely answer: a guest asking about "
            "airport transfer usually also needs to know check-out time and "
            "luggage storage. Always confirm the room number for anything "
            "delivered or charged. State prices with whether VAT and service "
            "charge are included. Switch to Arabic the moment a guest writes "
            "in Arabic, and use appropriately formal courtesy. Nothing is "
            "'not possible' — if you cannot do it, say what you can do "
            "instead."
        ),
        "guardrails": (
            "Never confirm a room upgrade, a rate change, a discount, a "
            "waived charge, or a compensation gesture — all of those are the "
            "Duty Manager's or Revenue team's decision, and you may only say "
            "you will request it. Never disclose whether a specific person is "
            "staying at the hotel, their room number, or any detail of their "
            "stay to anyone, including callers claiming to be family — this "
            "is an absolute rule. Never share another guest's information "
            "with a guest. Never guarantee a specific room number, floor, or "
            "view before the front office has assigned it. Never take card "
            "numbers, passport scans, or CVV in chat — always issue a secure "
            "payment link or direct the guest to the front desk. For any "
            "complaint involving illness, food safety, an injury, a security "
            "concern, or an allegation against a staff member, do not "
            "investigate or offer an explanation — acknowledge, apologise "
            "once, and escalate to the Duty Manager immediately. Never give "
            "medical advice; call the in-house doctor service instead."
        ),
        "response_behaviour": (
            "Gracious, polished and anticipatory — five-star service in "
            "writing. Warm but never over-familiar; address the guest by "
            "title and surname when known. Two to four sentences for a "
            "routine request, always ending with either a confirmed time or a "
            "clear next step. Use a short list only for genuine options "
            "(three restaurant times, two tour departures). Always include "
            "the practical detail a guest would otherwise have to ask for "
            "next: delivery time, dress code, pick-up point, what to bring. "
            "Mirror the guest's language precisely, and in Arabic use formal, "
            "hospitality-appropriate courtesy. Never say no without offering "
            "an alternative in the same message."
        ),
        "fallback_message": (
            "Thank you for contacting the concierge desk. A member of our "
            "guest services team will attend to your request personally and "
            "respond to you very shortly. For anything urgent, please dial 0 "
            "from your room phone at any hour.\n\n"
            "شكراً لتواصلك مع مكتب الكونسيرج. سيقوم أحد أعضاء فريق خدمة "
            "الضيوف بمتابعة طلبك شخصياً والرد عليك في أقرب وقت. لأي أمر عاجل، "
            "يرجى الاتصال بالرقم صفر من هاتف غرفتك في أي وقت."
        ),
        "temperature": 0.35,
        "tools_enabled": [
            "image_analysis",
            "voice_transcription",
            "document_ocr",
            "appointment_scheduling",
            "payment_links",
            "request_escalation",
        ],
        "context_history_limit": 10,
        "max_output_tokens": 2048,
        "kb": {
            "name": "Hotel Concierge & Guest Services KB",
            "description": (
                "Room service and amenities, dining venues, tours and "
                "transfers, check-in policy, and guest complaint escalation."
            ),
            "icon": "MapPin",
            "documents": [
                {
                    "title": "Guest Services, Check-in & Hotel Policy",
                    "chunks": [
                        "Check-in and check-out: standard check-in is from "
                        "15:00 and check-out is by 12:00. Early check-in from "
                        "09:00 is subject to availability and free for Club "
                        "and Suite guests; otherwise 50% of the nightly rate. "
                        "Late check-out to 18:00 is charged at 50% of the "
                        "nightly rate, and beyond 18:00 as a full night. "
                        "Complimentary luggage storage is available before "
                        "check-in and after check-out, with day-use shower "
                        "facilities in the spa for departing guests.",
                        "Tourism Dirham fee is charged per room per night, "
                        "collected at check-out and separate from the room "
                        "rate: AED 20 for a five-star hotel, AED 15 for "
                        "four-star, and AED 10 for three-star. Municipality fee "
                        "of 7% and service charge of 10% are applied to the "
                        "room rate, with 5% VAT applied on top. All published "
                        "rates state clearly whether they are inclusive or "
                        "exclusive of these charges.",
                        "Room service operates 24 hours. The full à la carte "
                        "menu is available 06:30-23:30, and a reduced overnight "
                        "menu from 23:30-06:30. Standard delivery is 30 minutes "
                        "for the main menu and 20 minutes for the overnight "
                        "menu; during breakfast peak (08:00-10:00) allow 45 "
                        "minutes. A tray charge of AED 35 applies to all room "
                        "service orders. Amenity requests — extra towels, "
                        "pillows, toiletries, an iron, a cot — are delivered "
                        "within 15 minutes at no charge.",
                        "Housekeeping runs 08:00-17:00 with a turndown service "
                        "18:00-21:00. A guest may request a specific service "
                        "time, request that the room is skipped, or ask for an "
                        "additional refresh at any time at no charge. Laundry "
                        "and pressing collected before 09:00 is returned the "
                        "same day by 18:00; express 4-hour service carries a "
                        "50% surcharge. There is no laundry collection on "
                        "Fridays.",
                        "Accessibility and family provision: accessible rooms "
                        "with roll-in showers and grab rails are available on "
                        "every floor and should be requested at booking. Cots "
                        "are free of charge; extra beds are AED 250 per night. "
                        "Children under 12 eat free from the children's menu "
                        "when dining with a paying adult. The Kids Club "
                        "operates 09:00-18:00 for ages 4-12 and is "
                        "complimentary; babysitting is AED 90 per hour with 4 "
                        "hours' notice.",
                        "Guest complaint handling: acknowledge immediately, "
                        "apologise once sincerely, and never explain or defend "
                        "before the guest has finished. Any complaint involving "
                        "illness or suspected food safety, an injury on "
                        "property, a security or safety concern, an allegation "
                        "against a staff member, or a request for compensation "
                        "goes to the Duty Manager within 15 minutes without "
                        "exception. Routine service complaints are resolved by "
                        "the department head within 2 hours. Every complaint is "
                        "logged with the room number, the time, and the "
                        "resolution offered.",
                    ],
                },
                {
                    "title": "Dining, Experiences & Transport",
                    "chunks": [
                        "Restaurant reservations should be made at least 24 "
                        "hours ahead for dinner, and 72 hours for Friday brunch "
                        "and any table of 8 or more. Always capture the number "
                        "of covers, the time, dietary requirements and "
                        "allergies, any occasion being celebrated, and whether "
                        "the guest wants indoor or terrace seating. Smart "
                        "casual is the minimum dress code across all venues; "
                        "the signature restaurant requires closed shoes and "
                        "long trousers for gentlemen after 19:00, and beachwear "
                        "is not permitted in any indoor venue.",
                        "Dietary handling: halal is standard across every "
                        "outlet. Vegetarian, vegan, gluten-free and lactose-"
                        "free options exist on every menu. Any allergy must be "
                        "noted on the reservation and repeated verbally to the "
                        "server on arrival — the kitchen prepares severe "
                        "allergy orders in a separate section, which needs 20 "
                        "minutes' additional preparation. Nut allergies are "
                        "flagged to the pastry kitchen specifically, as several "
                        "desserts share equipment.",
                        "Airport transfers: Dubai International (DXB) is 25-40 "
                        "minutes depending on traffic, and Al Maktoum (DWC) is "
                        "45-60 minutes. A luxury sedan seats 3 passengers with "
                        "3 bags at AED 350 to DXB; an SUV seats 6 with 6 bags "
                        "at AED 550; and a Rolls-Royce chauffeur transfer is "
                        "AED 1,400. Always confirm the flight number, terminal, "
                        "arrival time, passenger count and bag count. The "
                        "chauffeur meets arriving guests in the arrivals hall "
                        "with a name board and waits up to 90 minutes after "
                        "landing at no extra charge.",
                        "Signature experiences: the Desert Safari with dune "
                        "bashing, camel ride, BBQ dinner and entertainment runs "
                        "15:00-21:30 at AED 350 per person. The Old Dubai "
                        "Heritage Tour with the souks and an abra crossing runs "
                        "09:00-13:00 at AED 280. Burj Khalifa Level 124/125 "
                        "tickets are AED 240 off-peak and AED 400 for sunset "
                        "slots, which sell out 5-7 days ahead. A private yacht "
                        "charter from Dubai Marina is AED 1,800 per hour for up "
                        "to 12 guests with a 3-hour minimum. All tours include "
                        "hotel pick-up and drop-off.",
                        "Spa and leisure: the spa operates 09:00-22:00 with the "
                        "last treatment booked at 21:00. Treatments should be "
                        "booked 24 hours ahead, and guests are asked to arrive "
                        "20 minutes early for the thermal facilities, which are "
                        "complimentary with any treatment. Cancellations within "
                        "4 hours are charged at 50%. The pool and private beach "
                        "are open 07:00-19:00; cabanas are AED 450 per day and "
                        "should be reserved the previous evening. The gym is "
                        "open 24 hours to in-house guests.",
                    ],
                },
            ],
            "tables": [
                {
                    "name": "Dining Venues & Reservations",
                    "slug": "dining-venues",
                    "description": "Restaurant outlets with cuisine, hours, dress code and reservation notice.",
                    "columns": [
                        {"key": "venue", "label": "Venue"},
                        {"key": "cuisine", "label": "Cuisine"},
                        {"key": "hours", "label": "Hours"},
                        {"key": "dress", "label": "Dress Code"},
                        {"key": "avg_spend", "label": "Avg Spend (AED)"},
                        {"key": "notice", "label": "Booking Notice"},
                    ],
                    "rows": [
                        {"venue": "Al Mandhar", "cuisine": "Modern Emirati", "hours": "19:00 - 23:30", "dress": "Smart (closed shoes after 19:00)", "avg_spend": "450 pp", "notice": "24 hours"},
                        {"venue": "The Terrace", "cuisine": "International Buffet", "hours": "06:30 - 10:30, 12:30 - 15:00, 18:30 - 22:30", "dress": "Smart casual", "avg_spend": "260 pp", "notice": "None"},
                        {"venue": "Sakura", "cuisine": "Japanese / Teppanyaki", "hours": "18:00 - 23:00", "dress": "Smart casual", "avg_spend": "520 pp", "notice": "48 hours"},
                        {"venue": "Marea", "cuisine": "Mediterranean Seafood", "hours": "12:00 - 23:00", "dress": "Smart casual", "avg_spend": "390 pp", "notice": "24 hours"},
                        {"venue": "Friday Brunch (The Terrace)", "cuisine": "International", "hours": "12:30 - 16:00 Fridays", "dress": "Smart casual", "avg_spend": "425 pp", "notice": "72 hours"},
                        {"venue": "Pool Bar", "cuisine": "Light bites & beverages", "hours": "10:00 - 19:00", "dress": "Beachwear permitted", "avg_spend": "150 pp", "notice": "None"},
                        {"venue": "Private Beach Dining", "cuisine": "Bespoke set menu", "hours": "18:30 - 22:30", "dress": "Smart", "avg_spend": "1,200 for two", "notice": "72 hours"},
                    ],
                },
                {
                    "name": "Tours, Transfers & Experiences",
                    "slug": "tours-transfers",
                    "description": "Bookable experiences and transport with duration, pricing and pick-up details.",
                    "columns": [
                        {"key": "experience", "label": "Experience"},
                        {"key": "duration", "label": "Duration"},
                        {"key": "price", "label": "Price (AED)"},
                        {"key": "pickup", "label": "Pick-up"},
                        {"key": "includes", "label": "Includes"},
                        {"key": "notice", "label": "Notice"},
                    ],
                    "rows": [
                        {"experience": "Desert Safari with BBQ", "duration": "6.5 hours", "price": "350 pp", "pickup": "15:00 hotel lobby", "includes": "Dune bashing, camel ride, dinner, show", "notice": "24 hours"},
                        {"experience": "Old Dubai Heritage Tour", "duration": "4 hours", "price": "280 pp", "pickup": "09:00 hotel lobby", "includes": "Guide, souks, abra crossing, museum entry", "notice": "24 hours"},
                        {"experience": "Burj Khalifa 124/125 (off-peak)", "duration": "2 hours", "price": "240 pp", "pickup": "Self or transfer +120", "includes": "Entry ticket, skip-the-line", "notice": "48 hours"},
                        {"experience": "Burj Khalifa 124/125 (sunset)", "duration": "2 hours", "price": "400 pp", "pickup": "Self or transfer +120", "includes": "Entry ticket, prime time slot", "notice": "5-7 days"},
                        {"experience": "Private Yacht Charter", "duration": "3 hours min", "price": "1,800 per hour", "pickup": "Dubai Marina berth", "includes": "Skipper, crew, soft drinks, up to 12 guests", "notice": "72 hours"},
                        {"experience": "Airport Transfer — Sedan (DXB)", "duration": "25-40 min", "price": "350", "pickup": "Arrivals hall meet & greet", "includes": "3 passengers, 3 bags, 90 min waiting", "notice": "12 hours"},
                        {"experience": "Airport Transfer — SUV (DXB)", "duration": "25-40 min", "price": "550", "pickup": "Arrivals hall meet & greet", "includes": "6 passengers, 6 bags, 90 min waiting", "notice": "12 hours"},
                        {"experience": "Rolls-Royce Chauffeur Transfer", "duration": "25-40 min", "price": "1,400", "pickup": "Arrivals hall meet & greet", "includes": "3 passengers, chauffeur, refreshments", "notice": "24 hours"},
                    ],
                },
            ],
        },
    },
]


async def seed() -> None:
    if settings.environment != "local":
        raise SystemExit(
            f"Refusing to seed: ENVIRONMENT is {settings.environment!r}, not 'local'. "
            "This script deletes every row in the tables it writes."
        )

    async with SessionLocal() as db:
        # Children first. The FKs cascade, but being explicit means the order
        # does not silently depend on them.
        for model in (
            Workflow,
            Request, Message, Conversation, Contact,
            KBChunk, KBDocument, KBTableRow, KBTable,
            Inbox, Agent, User, KnowledgeBase,
        ):
            await db.execute(delete(model))
        await db.flush()

        # ---------------- users ----------------
        # Three tiers represented on purpose: Riley is the one Super Admin
        # (full system access, incl. the login-requirement toggle), Jordan is
        # a regular Admin with the default granted-permissions bundle
        # (Settings/Agents/Knowledge Base), Sam and Casey are plain agents
        # (day-to-day conversations/requests only). See auth/permissions.py.
        #
        # Invented people on the IANA-reserved example.com domain, with
        # repeated-digit phone numbers — this database is seeded into public
        # demo deployments, so nothing here may resemble a real colleague.
        admin = User(
            name="Riley Adams",
            email="riley.adams@example.com",
            # No seeded photo: every account starts with its initials
            # avatar, and a real one is uploaded from Settings → Profile.
            # A stock portrait from a third-party service also meant the
            # app made an outbound request for a picture of someone who
            # does not exist.
            avatar_url=None,
            role=UserRole.super_admin,
            job_title="Workspace Administrator",
            created_at=minutes_ago(60 * 24 * 90),
        )
        jordan = User(
            name="Jordan Blake",
            email="jordan.blake@example.com",
            role=UserRole.admin,
            granted_permissions=list(DEFAULT_ADMIN_PERMISSIONS),
            job_title="Customer Operations Manager",
            phone="+971 50 111 1111",
            created_at=minutes_ago(60 * 24 * 60),
        )
        sam = User(
            name="Sam Ellis",
            email="sam.ellis@example.com",
            role=UserRole.agent,
            job_title="Service Delivery Coordinator",
            phone="+971 50 222 2222",
            created_at=minutes_ago(60 * 24 * 45),
        )
        casey = User(
            name="Casey Fox",
            email="casey.fox@example.com",
            role=UserRole.agent,
            job_title="Guest & Client Support Agent",
            phone="+971 50 333 3333",
            created_at=minutes_ago(60 * 24 * 14),
        )
        staff = [admin, jordan, sam, casey]
        db.add_all(staff)

        # ---------------- inboxes ----------------
        # No default_agent_id: each conversation below sets its own agent_id
        # explicitly (5 different specialists, not one blanket default) — a
        # channel with no default agent is a supported, non-broken state,
        # see orchestrator._resolve_agent.
        # One consistent "Customer Support — {channel}" naming template across
        # all four — not a business-domain-specific label (the domain lives on
        # the agents/knowledge bases, not the inbox), and not two different
        # punctuation styles for no reason.
        db.add_all(
            [
                Inbox(
                    name="Customer Support — WhatsApp",
                    channel=Channel.whatsapp,
                    status=InboxStatus.connected,
                    account_identifier="+971 4 000 0000",
                    last_synced_at=minutes_ago(3),
                    created_at=minutes_ago(60 * 24 * 25),
                ),
                Inbox(
                    name="Customer Support — Telegram",
                    channel=Channel.telegram,
                    status=InboxStatus.pending,
                    account_identifier="@customer_support_bot",
                    last_synced_at=None,
                    created_at=minutes_ago(60 * 24 * 2),
                ),
                Inbox(
                    name="Customer Support — Instagram",
                    channel=Channel.instagram,
                    status=InboxStatus.pending,
                    account_identifier="@customer.support",
                    last_synced_at=None,
                    created_at=minutes_ago(60 * 24 * 2),
                ),
                Inbox(
                    name="Customer Support — Email",
                    channel=Channel.email,
                    status=InboxStatus.pending,
                    account_identifier="support@example.com",
                    last_synced_at=None,
                    created_at=minutes_ago(60 * 24 * 2),
                ),
            ]
        )
        await db.flush()

        # ---------------- agents + knowledge bases ----------------
        # Exactly 5 of each, 1:1 by construction (each Agent gets the
        # knowledge_base_id of the KnowledgeBase built right alongside it) —
        # the DB's own unique constraint on agents.knowledge_base_id would
        # reject anything else. Real embeddings (embed_passages, the same
        # local bge-m3 model the live ingestion pipeline uses), not a fake
        # random vector — a seeded agent's Test Environment should actually
        # retrieve something meaningful, not silence.
        agents_by_key: dict[str, Agent] = {}
        chunks_by_key: dict[str, list[KBChunk]] = {}

        # `agent_index` staggers each agent's and knowledge base's
        # created_at. Not cosmetic: list_agents orders by created_at, and
        # five rows sharing one timestamp leaves the tie for Postgres to
        # break by physical row order — which shifts the moment an agent is
        # saved, visibly reshuffling the grid.
        for agent_index, agent_def in enumerate(AGENT_DEFS):
            kb_def = agent_def["kb"]
            knowledge_base = KnowledgeBase(
                name=kb_def["name"],
                description=kb_def["description"],
                icon=kb_def["icon"],
                created_at=minutes_ago(60 * 24 * 20 - agent_index * 60),
            )
            db.add(knowledge_base)
            await db.flush()

            # Several documents per knowledge base, each with its own chunks —
            # one giant "playbook" retrieves badly, because every query pulls
            # from the same undifferentiated pile. All of a KB's chunks are
            # collected into one list for the message-citation helper below,
            # which only needs a chunk to point at.
            kb_chunks: list[KBChunk] = []
            for doc_index, doc_def in enumerate(kb_def["documents"]):
                document = KBDocument(
                    knowledge_base_id=knowledge_base.id,
                    title=doc_def["title"],
                    source_type=SourceType.docx,
                    language="en",
                    uploaded_at=minutes_ago(60 * 24 * (20 - doc_index)),
                )
                db.add(document)
                await db.flush()

                embeddings = embed_passages(doc_def["chunks"])
                chunks = [
                    KBChunk(
                        kb_document_id=document.id,
                        content=text,
                        embedding=embedding,
                        chunk_index=index,
                    )
                    for index, (text, embedding) in enumerate(
                        zip(doc_def["chunks"], embeddings)
                    )
                ]
                db.add_all(chunks)
                await db.flush()
                kb_chunks.extend(chunks)

            chunks_by_key[agent_def["key"]] = kb_chunks

            for table_def in kb_def["tables"]:
                table = KBTable(
                    knowledge_base_id=knowledge_base.id,
                    name=table_def["name"],
                    slug=table_def["slug"],
                    description=table_def["description"],
                    columns=table_def["columns"],
                )
                db.add(table)
                await db.flush()
                db.add_all(
                    KBTableRow(kb_table_id=table.id, data=row, position=position)
                    for position, row in enumerate(table_def["rows"])
                )

            agent = Agent(
                name=agent_def["name"],
                description=agent_def["description"],
                status=AgentStatus.active,
                system_prompt=agent_def["system_prompt"],
                temperature=agent_def["temperature"],
                knowledge_base_id=knowledge_base.id,
                icon=agent_def["icon"],
                guardrails=agent_def["guardrails"],
                tools_enabled=agent_def["tools_enabled"],
                response_behaviour=agent_def["response_behaviour"],
                fallback_message=agent_def["fallback_message"],
                context_history_limit=agent_def["context_history_limit"],
                max_output_tokens=agent_def["max_output_tokens"],
                owner_user_id=jordan.id,
                created_at=minutes_ago(60 * 24 * 20 - agent_index * 60),
            )
            db.add(agent)
            await db.flush()
            agents_by_key[agent_def["key"]] = agent

        def cited(chunk: KBChunk, score: float) -> list[dict]:
            return [{"chunk_id": str(chunk.id), "kb_document_id": str(chunk.kb_document_id), "score": score}]

        # ---------------- contacts ----------------
        # Generic placeholders, not real names — see module docstring.
        contacts = [
            Contact(
                name=f"Person {n}",
                phone_number=f"+97150{n}{n}{n}{n}{n}{n}{n}",
                channel=Channel.whatsapp,
                language="en",
                created_at=minutes_ago(60 * 24 * (14 - n * 2)),
            )
            for n in range(1, 6)
        ]
        person1, person2, person3, person4, person5 = contacts
        db.add_all(contacts)
        await db.flush()

        # ---------------- conversations ----------------
        # One per agent, each explicitly routed via agent_id — a direct,
        # legible 1:1 pairing rather than something inferred from inbox
        # routing, matching "clearly associate each conversation with the
        # appropriate agent."
        #
        # Each conversation's own `started_at` anchors its messages via
        # `started_at + timedelta(minutes=X)` with X increasing message by
        # message — deliberately not `minutes_ago(BASE - X)` a second time:
        # that pattern reads backwards (a *larger* X there means *earlier*,
        # not later) and is exactly what produced a real bug the first time
        # this file used it for a single pair of timestamps. Plain addition
        # off a fixed start avoids the whole class of mistake.
        realestate_started = minutes_ago(60 * 24 * 12)
        beauty_started = minutes_ago(60 * 24 * 9)
        automotive_started = minutes_ago(60 * 24 * 6)
        homeservices_started = minutes_ago(60 * 24 * 3)
        hospitality_started = minutes_ago(60 * 24)

        conv_realestate = Conversation(
            contact_id=person1.id, status=ConversationStatus.open,
            agent_id=agents_by_key["realestate"].id, assigned_agent_id=jordan.id,
            last_incoming_at=realestate_started + timedelta(minutes=14),
            created_at=realestate_started,
        )
        conv_beauty = Conversation(
            contact_id=person2.id, status=ConversationStatus.pending,
            agent_id=agents_by_key["beauty"].id, assigned_agent_id=sam.id,
            last_incoming_at=beauty_started + timedelta(minutes=26),
            created_at=beauty_started,
        )
        conv_automotive = Conversation(
            contact_id=person3.id, status=ConversationStatus.resolved,
            agent_id=agents_by_key["automotive"].id, assigned_agent_id=None,
            last_incoming_at=automotive_started + timedelta(minutes=38),
            created_at=automotive_started,
        )
        conv_homeservices = Conversation(
            contact_id=person4.id, status=ConversationStatus.pending,
            agent_id=agents_by_key["homeservices"].id, assigned_agent_id=admin.id,
            last_incoming_at=homeservices_started + timedelta(minutes=9),
            created_at=homeservices_started,
        )
        conv_hospitality = Conversation(
            contact_id=person5.id, status=ConversationStatus.open,
            agent_id=agents_by_key["hospitality"].id, assigned_agent_id=jordan.id,
            last_incoming_at=hospitality_started + timedelta(minutes=18),
            created_at=hospitality_started,
        )
        conv_realestate.tags = ["viewing"]
        conv_beauty.tags = ["booking", "deposit"]
        conv_automotive.tags = ["diagnostics"]
        conv_homeservices.tags = ["emergency", "urgent"]
        conv_hospitality.tags = ["concierge"]

        conversations = [
            conv_realestate, conv_beauty, conv_automotive,
            conv_homeservices, conv_hospitality,
        ]
        db.add_all(conversations)
        await db.flush()

        realestate_chunks = chunks_by_key["realestate"]
        beauty_chunks = chunks_by_key["beauty"]
        automotive_chunks = chunks_by_key["automotive"]
        homeservices_chunks = chunks_by_key["homeservices"]
        hospitality_chunks = chunks_by_key["hospitality"]

        # ---------------- messages ----------------
        db.add_all([
            # Person 1 <-> Real Estate & Holiday Home Specialist
            Message(conversation_id=conv_realestate.id, direction=MessageDirection.incoming,
                    text="Hi, I saw a 2 bedroom listed in Dubai Marina. Is it still available and what's the rent?",
                    status=MessageStatus.received, kb_chunks_used=None,
                    created_at=realestate_started),
            Message(conversation_id=conv_realestate.id, direction=MessageDirection.outgoing,
                    text=("Yes, we currently have 7 two-bedroom units available in Dubai Marina. "
                          "Rent ranges from AED 140,000 to AED 195,000 per year depending on the "
                          "tower, floor and view, with a service charge of AED 18.50 per sq ft. "
                          "May I ask your preferred budget and whether you're looking to move in "
                          "immediately or later in the year?"),
                    status=MessageStatus.read,
                    kb_chunks_used=cited(realestate_chunks[6], 0.89),
                    created_at=realestate_started + timedelta(minutes=2)),
            Message(conversation_id=conv_realestate.id, direction=MessageDirection.incoming,
                    text="Budget is around 160k. Moving in next month. What are the upfront costs?",
                    status=MessageStatus.received, kb_chunks_used=None,
                    created_at=realestate_started + timedelta(minutes=6)),
            Message(conversation_id=conv_realestate.id, direction=MessageDirection.outgoing,
                    text=("At AED 160,000 you'll have a good choice of units. Upfront you should "
                          "budget the agency commission of 5% of annual rent (AED 8,000), a "
                          "refundable security deposit of 5% for an unfurnished unit (AED 8,000) "
                          "or 10% if furnished, and Ejari registration at AED 155. Paying in a "
                          "single cheque usually secures a 3-5% better rate than four cheques."),
                    status=MessageStatus.read,
                    kb_chunks_used=cited(realestate_chunks[1], 0.94),
                    created_at=realestate_started + timedelta(minutes=8)),
            Message(conversation_id=conv_realestate.id, direction=MessageDirection.incoming,
                    text="That works. Can I see a couple of units this weekend?",
                    status=MessageStatus.received, kb_chunks_used=None,
                    created_at=realestate_started + timedelta(minutes=14)),
            Message(conversation_id=conv_realestate.id, direction=MessageDirection.outgoing,
                    text=("Of course. I can arrange three units on Saturday — 11:00, 13:00 or "
                          "16:00 all work. Please bring a copy of your Emirates ID or passport, "
                          "as most Marina towers require it for building access. Which time suits "
                          "you best?"),
                    status=MessageStatus.delivered,
                    kb_chunks_used=None,
                    created_at=realestate_started + timedelta(minutes=16)),

            # Person 2 <-> Luxury Beauty & Wellness Specialist
            Message(conversation_id=conv_beauty.id, direction=MessageDirection.incoming,
                    text="مرحبا، أريد حجز موعد للبالاياج مع تنظيف بشرة في نفس اليوم. هل هذا ممكن؟",
                    status=MessageStatus.received, kb_chunks_used=None,
                    created_at=beauty_started),
            Message(conversation_id=conv_beauty.id, direction=MessageDirection.outgoing,
                    text=("بالتأكيد، يمكننا ترتيب ذلك في نفس اليوم. البالاياج يستغرق حوالي ٣ ساعات "
                          "ونصف (٩٥٠ إلى ١٦٠٠ درهم)، وجلسة الهيدرافيشل ساعة واحدة (٧٥٠ درهم)، مع "
                          "١٠ دقائق للانتقال بين الخدمتين — أي ما مجموعه حوالي ٤ ساعات و٥٠ دقيقة. "
                          "البالاياج يتطلب استشارة مسبقة. في أي فرع تفضلين؟"),
                    status=MessageStatus.read,
                    kb_chunks_used=cited(beauty_chunks[3], 0.91),
                    created_at=beauty_started + timedelta(minutes=3)),
            Message(conversation_id=conv_beauty.id, direction=MessageDirection.incoming,
                    text="Downtown branch please. Can I book with Layla? And is a deposit required?",
                    status=MessageStatus.received, kb_chunks_used=None,
                    created_at=beauty_started + timedelta(minutes=11)),
            Message(conversation_id=conv_beauty.id, direction=MessageDirection.outgoing,
                    text=("Layla is based at our Dubai Marina branch and works Saturday to "
                          "Wednesday. At Downtown, Noor is our master colourist — both carry a "
                          "35% senior surcharge. Yes, a deposit applies: this booking is over AED "
                          "500 and over 2 hours, so AED 200 is payable by secure link and is "
                          "deducted from your final bill. Shall I hold a provisional slot while "
                          "the team confirms Noor's roster?"),
                    status=MessageStatus.read,
                    kb_chunks_used=cited(beauty_chunks[0], 0.93),
                    created_at=beauty_started + timedelta(minutes=14)),
            Message(conversation_id=conv_beauty.id, direction=MessageDirection.incoming,
                    text="Yes please hold it. Also I've never coloured my hair here before.",
                    status=MessageStatus.received, kb_chunks_used=None,
                    created_at=beauty_started + timedelta(minutes=26)),
            Message(conversation_id=conv_beauty.id, direction=MessageDirection.outgoing,
                    text=("Noted — as a first-time colour client you'll need a complimentary patch "
                          "test 48 hours before the appointment, which takes about 10 minutes. "
                          "I've flagged this for our booking coordinator to confirm Noor's "
                          "availability and arrange both the patch test and your deposit link."),
                    status=MessageStatus.delivered,
                    kb_chunks_used=cited(beauty_chunks[3], 0.88),
                    created_at=beauty_started + timedelta(minutes=28)),

            # Person 3 <-> Automotive Diagnostics & Workshop Intake Specialist
            Message(conversation_id=conv_automotive.id, direction=MessageDirection.incoming,
                    text="My AC has stopped blowing cold. 2019 Nissan Patrol, about 96,000 km. Still drivable.",
                    status=MessageStatus.received, kb_chunks_used=None,
                    created_at=automotive_started),
            Message(conversation_id=conv_automotive.id, direction=MessageDirection.outgoing,
                    text=("Thanks — a 2019 Patrol at 96,000 km with weak cooling is most commonly "
                          "low refrigerant from a slow leak, a blocked cabin filter, or a failing "
                          "compressor clutch. The car is safe to drive. I'd recommend our AC "
                          "Performance & Leak Test at AED 550-1,400, which takes about 90 minutes "
                          "and includes UV dye leak detection."),
                    status=MessageStatus.read,
                    kb_chunks_used=cited(automotive_chunks[3], 0.95),
                    created_at=automotive_started + timedelta(minutes=4)),
            Message(conversation_id=conv_automotive.id, direction=MessageDirection.incoming,
                    text="Why not just top up the gas? That's what the last place did.",
                    status=MessageStatus.received, kb_chunks_used=None,
                    created_at=automotive_started + timedelta(minutes=19)),
            Message(conversation_id=conv_automotive.id, direction=MessageDirection.outgoing,
                    text=("We don't offer a regas without finding the leak first. If there's a "
                          "leak the refrigerant will be gone again within weeks, and running the "
                          "system low on oil can seize the compressor — which is a far more "
                          "expensive repair. The leak test finds the actual cause, and if no leak "
                          "is found the regas is included in that same price."),
                    status=MessageStatus.read,
                    kb_chunks_used=cited(automotive_chunks[3], 0.92),
                    created_at=automotive_started + timedelta(minutes=22)),
            Message(conversation_id=conv_automotive.id, direction=MessageDirection.incoming,
                    text="Makes sense. Book me in for Tuesday morning.",
                    status=MessageStatus.received, kb_chunks_used=None,
                    created_at=automotive_started + timedelta(minutes=38)),
            Message(conversation_id=conv_automotive.id, direction=MessageDirection.outgoing,
                    text=("Booked — 2019 Nissan Patrol, AC Performance & Leak Test, Tuesday at "
                          "09:00, approximately 90 minutes. Our customer lounge has WiFi if you'd "
                          "prefer to wait. We'll call you with the findings before carrying out "
                          "any work."),
                    status=MessageStatus.read,
                    kb_chunks_used=None,
                    created_at=automotive_started + timedelta(minutes=40)),

            # Person 4 <-> Home Services & Field Dispatch Specialist
            Message(conversation_id=conv_homeservices.id, direction=MessageDirection.incoming,
                    text="URGENT there is water leaking from the ceiling near a light fitting in my living room",
                    status=MessageStatus.received, kb_chunks_used=None,
                    created_at=homeservices_started),
            Message(conversation_id=conv_homeservices.id, direction=MessageDirection.outgoing,
                    text=("Please switch off the main breaker at your distribution board right now "
                          "before touching anything — water entering an electrical fitting is a "
                          "shock risk. Keep everyone away from that area. This is an emergency "
                          "dispatch. I need your community, building name, apartment number and a "
                          "nearest landmark, or please share your location pin."),
                    status=MessageStatus.read,
                    kb_chunks_used=cited(homeservices_chunks[2], 0.97),
                    created_at=homeservices_started + timedelta(minutes=1)),
            Message(conversation_id=conv_homeservices.id, direction=MessageDirection.incoming,
                    text="Breaker is off. Marina Diamond 4, apartment 1802, opposite Marina Walk.",
                    status=MessageStatus.received, kb_chunks_used=None,
                    created_at=homeservices_started + timedelta(minutes=5)),
            Message(conversation_id=conv_homeservices.id, direction=MessageDirection.outgoing,
                    text=("Thank you — confirming Marina Diamond 4, apartment 1802, opposite "
                          "Marina Walk, Dubai Marina. That's Zone A, so an emergency plumber and "
                          "electrician will be dispatched within 90 minutes. The technician will "
                          "call you 20 minutes before arriving. Emergency call-out is AED 250 "
                          "within hours, which covers travel and the first 30 minutes on site."),
                    status=MessageStatus.read,
                    kb_chunks_used=cited(homeservices_chunks[0], 0.94),
                    created_at=homeservices_started + timedelta(minutes=7)),
            Message(conversation_id=conv_homeservices.id, direction=MessageDirection.incoming,
                    text="It's getting worse, water is coming through faster now. The neighbour upstairs isn't answering.",
                    status=MessageStatus.received, kb_chunks_used=None,
                    created_at=homeservices_started + timedelta(minutes=9)),
            Message(conversation_id=conv_homeservices.id, direction=MessageDirection.outgoing,
                    text=("Understood — I'm escalating this to our operations supervisor now, as "
                          "the source is likely in the unit above and will need building "
                          "management to gain access. Please place buckets and move any "
                          "electricals clear. A supervisor will call you directly within minutes."),
                    status=MessageStatus.delivered,
                    kb_chunks_used=cited(homeservices_chunks[5], 0.90),
                    created_at=homeservices_started + timedelta(minutes=11)),

            # Person 5 <-> Luxury Hospitality & Hotel Concierge Specialist
            Message(conversation_id=conv_hospitality.id, direction=MessageDirection.incoming,
                    text="Good evening, we arrive Friday on EK203 and would like an airport pickup for 4 people.",
                    status=MessageStatus.received, kb_chunks_used=None,
                    created_at=hospitality_started),
            Message(conversation_id=conv_hospitality.id, direction=MessageDirection.outgoing,
                    text=("Good evening, and welcome. For four guests I'd recommend our SUV "
                          "transfer at AED 550, which seats six with six bags — the sedan takes "
                          "three passengers only. Your chauffeur will meet you in the arrivals "
                          "hall with a name board and waits up to 90 minutes after landing at no "
                          "extra charge. May I confirm your terminal and total number of bags?"),
                    status=MessageStatus.read,
                    kb_chunks_used=cited(hospitality_chunks[8], 0.96),
                    created_at=hospitality_started + timedelta(minutes=3)),
            Message(conversation_id=conv_hospitality.id, direction=MessageDirection.incoming,
                    text="Terminal 3, five bags. Also can you book dinner Friday night, somewhere nice?",
                    status=MessageStatus.received, kb_chunks_used=None,
                    created_at=hospitality_started + timedelta(minutes=10)),
            Message(conversation_id=conv_hospitality.id, direction=MessageDirection.outgoing,
                    text=("Noted — SUV transfer, Terminal 3, four guests and five bags. For dinner "
                          "I'd suggest Al Mandhar, our modern Emirati restaurant, from 19:00 "
                          "(around AED 450 per person), or Sakura for Japanese teppanyaki from "
                          "18:00 (around AED 520). Both require closed shoes and long trousers for "
                          "gentlemen after 19:00. Do you have any dietary requirements or "
                          "allergies I should note?"),
                    status=MessageStatus.read,
                    kb_chunks_used=cited(hospitality_chunks[6], 0.93),
                    created_at=hospitality_started + timedelta(minutes=13)),
            Message(conversation_id=conv_hospitality.id, direction=MessageDirection.incoming,
                    text="Al Mandhar at 8pm please. One of us has a severe nut allergy.",
                    status=MessageStatus.received, kb_chunks_used=None,
                    created_at=hospitality_started + timedelta(minutes=18)),
            Message(conversation_id=conv_hospitality.id, direction=MessageDirection.outgoing,
                    text=("Al Mandhar, Friday at 20:00 for four guests, with a severe nut allergy "
                          "noted. I've flagged it to the pastry kitchen specifically, as several "
                          "desserts share equipment. Please also mention it to your server on "
                          "arrival — severe allergy orders are prepared in a separate section and "
                          "need about 20 minutes' extra preparation."),
                    status=MessageStatus.delivered,
                    kb_chunks_used=cited(hospitality_chunks[7], 0.95),
                    created_at=hospitality_started + timedelta(minutes=21)),
        ])

        # ---------------- requests ----------------
        db.add_all([
            Request(conversation_id=conv_realestate.id, category=RequestCategory.reschedule,
                    priority=RequestPriority.normal,
                    title="Arrange Saturday viewings — 3 x 2BR Dubai Marina, budget AED 160k",
                    status=RequestStatus.pending, assigned_agent_id=jordan.id,
                    created_at=realestate_started + timedelta(minutes=17)),
            Request(conversation_id=conv_beauty.id, category=RequestCategory.order,
                    priority=RequestPriority.high,
                    title="Confirm Noor's availability + issue deposit link and patch test slot",
                    status=RequestStatus.pending, assigned_agent_id=sam.id,
                    created_at=beauty_started + timedelta(minutes=29)),
            Request(conversation_id=conv_automotive.id, category=RequestCategory.other,
                    priority=RequestPriority.normal,
                    title="AC leak test — 2019 Nissan Patrol, Tuesday 09:00 bay reserved",
                    status=RequestStatus.completed, assigned_agent_id=sam.id,
                    created_at=automotive_started + timedelta(minutes=41),
                    completed_at=automotive_started + timedelta(minutes=190)),
            Request(conversation_id=conv_homeservices.id, category=RequestCategory.human_request,
                    priority=RequestPriority.urgent,
                    title="Emergency escalation — ceiling leak into light fitting, Marina Diamond 4 / 1802",
                    status=RequestStatus.pending, assigned_agent_id=admin.id,
                    created_at=homeservices_started + timedelta(minutes=12)),
            Request(conversation_id=conv_hospitality.id, category=RequestCategory.order,
                    priority=RequestPriority.normal,
                    title="Friday: SUV airport transfer EK203 T3 + Al Mandhar 20:00 (nut allergy)",
                    status=RequestStatus.pending, assigned_agent_id=jordan.id,
                    created_at=hospitality_started + timedelta(minutes=22)),
        ])
        await db.flush()

        # ---------------- workflows ----------------
        # Five real automations, one per agent, covering every shape the
        # builder supports: branching conditions, a scheduled sweep, a delay,
        # and a human approval gate. Seeded as `draft` rather than active on
        # purpose — a fresh install must not start messaging customers or
        # mutating requests until someone has read what these do and enabled
        # them deliberately.
        db.add_all([
            Workflow(
                name="Qualify and route new property leads",
                description=(
                    "When a property inquiry comes in, tag it, assign a consultant, and "
                    "notify them so a viewing is offered while the lead is still warm."
                ),
                status=WorkflowStatus.draft,
                agent_id=agents_by_key["realestate"].id,
                created_by_user_id=admin.id,
                webhook_token=secrets.token_urlsafe(24),
                created_at=minutes_ago(60 * 24 * 5),
                graph={
                    "nodes": [
                        {"id": "trigger-1", "kind": "trigger", "type": "message_received",
                         "position": {"x": 40, "y": 200}, "config": {"channel": "any"}},
                        {"id": "condition-1", "kind": "condition", "type": "",
                         "position": {"x": 370, "y": 200},
                         "config": {"match": "any", "groups": [{
                             "match": "any",
                             "rules": [
                                 {"field": "message.text", "operator": "contains", "value": "viewing"},
                                 {"field": "message.text", "operator": "contains", "value": "bedroom"},
                                 {"field": "message.text", "operator": "contains", "value": "rent"},
                             ],
                         }]}},
                        {"id": "action-1", "kind": "action", "type": "add_tag",
                         "position": {"x": 700, "y": 110}, "config": {"tag": "hot-lead"}},
                        {"id": "action-2", "kind": "action", "type": "assign_user",
                         "position": {"x": 1030, "y": 110}, "config": {"user_id": str(jordan.id)}},
                        {"id": "action-3", "kind": "action", "type": "notify_user",
                         "position": {"x": 1360, "y": 110},
                         "config": {"user_id": str(jordan.id),
                                    "title": "New property lead — {{ contact.name }}",
                                    "body": "Offer viewing slots while the lead is warm."}},
                    ],
                    "edges": [
                        {"id": "e1", "source": "trigger-1", "target": "condition-1", "branch": None},
                        {"id": "e2", "source": "condition-1", "target": "action-1", "branch": "true"},
                        {"id": "e3", "source": "action-1", "target": "action-2", "branch": None},
                        {"id": "e4", "source": "action-2", "target": "action-3", "branch": None},
                    ],
                },
            ),
            Workflow(
                name="Salon booking deposit follow-up",
                description=(
                    "Wait two hours after a booking request, then remind the coordinator "
                    "to chase the deposit link if the booking is still unconfirmed."
                ),
                status=WorkflowStatus.draft,
                agent_id=agents_by_key["beauty"].id,
                created_by_user_id=admin.id,
                webhook_token=secrets.token_urlsafe(24),
                created_at=minutes_ago(60 * 24 * 4),
                graph={
                    "nodes": [
                        {"id": "trigger-1", "kind": "trigger", "type": "tag_added",
                         "position": {"x": 40, "y": 200}, "config": {"tag": "deposit"}},
                        {"id": "delay-1", "kind": "delay", "type": "",
                         "position": {"x": 370, "y": 200}, "config": {"minutes": 120}},
                        {"id": "condition-1", "kind": "condition", "type": "",
                         "position": {"x": 700, "y": 200},
                         "config": {"match": "all", "groups": [{
                             "match": "all",
                             "rules": [
                                 {"field": "conversation.status", "operator": "not_equals",
                                  "value": "resolved"},
                             ],
                         }]}},
                        {"id": "action-1", "kind": "action", "type": "notify_user",
                         "position": {"x": 1030, "y": 110},
                         "config": {"user_id": str(sam.id),
                                    "title": "Deposit still outstanding — {{ contact.name }}",
                                    "body": "Booking has not been confirmed two hours after the deposit link."}},
                    ],
                    "edges": [
                        {"id": "e1", "source": "trigger-1", "target": "delay-1", "branch": None},
                        {"id": "e2", "source": "delay-1", "target": "condition-1", "branch": None},
                        {"id": "e3", "source": "condition-1", "target": "action-1", "branch": "true"},
                    ],
                },
            ),
            Workflow(
                name="Workshop intake acknowledgement",
                description=(
                    "Acknowledge every new workshop conversation immediately with what "
                    "the advisor needs, so the customer is never left waiting in silence."
                ),
                status=WorkflowStatus.draft,
                agent_id=agents_by_key["automotive"].id,
                created_by_user_id=admin.id,
                webhook_token=secrets.token_urlsafe(24),
                created_at=minutes_ago(60 * 24 * 3),
                graph={
                    "nodes": [
                        {"id": "trigger-1", "kind": "trigger", "type": "conversation_created",
                         "position": {"x": 40, "y": 200}, "config": {"channel": "any"}},
                        {"id": "action-1", "kind": "action", "type": "send_message",
                         "position": {"x": 370, "y": 200},
                         "config": {"text": "Thanks for contacting our service centre. To get you "
                                            "booked in quickly, please send your vehicle's make, "
                                            "model, year and approximate mileage — and a photo of "
                                            "any warning light if one is showing."}},
                        {"id": "action-2", "kind": "action", "type": "add_tag",
                         "position": {"x": 700, "y": 200}, "config": {"tag": "intake"}},
                    ],
                    "edges": [
                        {"id": "e1", "source": "trigger-1", "target": "action-1", "branch": None},
                        {"id": "e2", "source": "action-1", "target": "action-2", "branch": None},
                    ],
                },
            ),
            Workflow(
                name="Emergency dispatch escalation",
                description=(
                    "Any urgent-tagged field job is assigned to the operations supervisor "
                    "and flagged immediately, day or night."
                ),
                status=WorkflowStatus.draft,
                agent_id=agents_by_key["homeservices"].id,
                created_by_user_id=admin.id,
                webhook_token=secrets.token_urlsafe(24),
                created_at=minutes_ago(60 * 24 * 2),
                graph={
                    "nodes": [
                        {"id": "trigger-1", "kind": "trigger", "type": "tag_added",
                         "position": {"x": 40, "y": 200}, "config": {"tag": "urgent"}},
                        {"id": "condition-1", "kind": "condition", "type": "",
                         "position": {"x": 370, "y": 200},
                         "config": {"match": "any", "groups": [{
                             "match": "any",
                             "rules": [
                                 {"field": "message.text", "operator": "contains", "value": "leak"},
                                 {"field": "message.text", "operator": "contains", "value": "gas"},
                                 {"field": "message.text", "operator": "contains", "value": "electric"},
                                 {"field": "conversation.tags", "operator": "contains", "value": "emergency"},
                             ],
                         }]}},
                        {"id": "action-1", "kind": "action", "type": "set_conversation_status",
                         "position": {"x": 700, "y": 110}, "config": {"status": "pending"}},
                        {"id": "action-2", "kind": "action", "type": "assign_user",
                         "position": {"x": 1030, "y": 110}, "config": {"user_id": str(admin.id)}},
                        {"id": "action-3", "kind": "action", "type": "notify_user",
                         "position": {"x": 1360, "y": 110},
                         "config": {"user_id": str(admin.id),
                                    "title": "EMERGENCY dispatch — {{ contact.name }}",
                                    "body": "Safety-critical field job flagged. Confirm technician within 90 minutes."}},
                        {"id": "action-4", "kind": "action", "type": "add_contact_note",
                         "position": {"x": 700, "y": 320},
                         "config": {"text": "Tagged urgent but no safety keyword matched — handled as standard priority."}},
                    ],
                    "edges": [
                        {"id": "e1", "source": "trigger-1", "target": "condition-1", "branch": None},
                        {"id": "e2", "source": "condition-1", "target": "action-1", "branch": "true"},
                        {"id": "e3", "source": "action-1", "target": "action-2", "branch": None},
                        {"id": "e4", "source": "action-2", "target": "action-3", "branch": None},
                        {"id": "e5", "source": "condition-1", "target": "action-4", "branch": "false"},
                    ],
                },
            ),
            Workflow(
                name="High-value concierge request approval",
                description=(
                    "Pause on a high or urgent guest request until the Duty Manager "
                    "approves it, then confirm to the guest either way."
                ),
                status=WorkflowStatus.draft,
                agent_id=agents_by_key["hospitality"].id,
                created_by_user_id=admin.id,
                webhook_token=secrets.token_urlsafe(24),
                created_at=minutes_ago(60 * 24),
                graph={
                    "nodes": [
                        {"id": "trigger-1", "kind": "trigger", "type": "request_created",
                         "position": {"x": 40, "y": 200}, "config": {"category": "order"}},
                        {"id": "condition-1", "kind": "condition", "type": "",
                         "position": {"x": 370, "y": 200},
                         "config": {"match": "any", "groups": [{
                             "match": "any",
                             "rules": [
                                 {"field": "request.priority", "operator": "equals", "value": "high"},
                                 {"field": "request.priority", "operator": "equals", "value": "urgent"},
                             ],
                         }]}},
                        {"id": "approval-1", "kind": "approval", "type": "",
                         "position": {"x": 700, "y": 110},
                         "config": {"title": "Duty Manager approval — {{ contact.name }}",
                                    "priority": "high", "user_id": str(admin.id)}},
                        {"id": "action-1", "kind": "action", "type": "send_message",
                         "position": {"x": 1030, "y": 20},
                         "config": {"text": "Your request has been confirmed with our Duty Manager. "
                                            "Everything is arranged — we look forward to welcoming you."}},
                        {"id": "action-2", "kind": "action", "type": "send_message",
                         "position": {"x": 1030, "y": 230},
                         "config": {"text": "Thank you for your patience. We are unable to confirm "
                                            "this exactly as requested — a member of our guest "
                                            "services team will call you shortly with an alternative."}},
                    ],
                    "edges": [
                        {"id": "e1", "source": "trigger-1", "target": "condition-1", "branch": None},
                        {"id": "e2", "source": "condition-1", "target": "approval-1", "branch": "true"},
                        {"id": "e3", "source": "approval-1", "target": "action-1", "branch": "true"},
                        {"id": "e4", "source": "approval-1", "target": "action-2", "branch": "false"},
                    ],
                },
            ),
        ])

        await db.commit()

    print(
        f"Seeded: {len(staff)} users, 5 knowledge bases, 5 agents, 4 inboxes, "
        f"{len(contacts)} contacts, {len(conversations)} conversations, "
        f"{sum(len(a['kb']['documents']) for a in AGENT_DEFS)} kb_documents, "
        f"{sum(len(c) for c in chunks_by_key.values())} kb_chunks, "
        f"{sum(len(a['kb']['tables']) for a in AGENT_DEFS)} kb_tables, "
        f"5 requests, 5 workflows."
    )


if __name__ == "__main__":
    asyncio.run(seed())
