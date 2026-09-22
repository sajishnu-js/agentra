"""Server-side masking for customer contact details.

The dashboard has always *displayed* a masked phone number (see
frontend/src/lib/format.ts `maskPhoneNumber`), and every single place the
frontend touches `phone_number` runs it through that helper — the raw value
is never rendered anywhere. But the API was still sending the full number in
every conversation payload, so it was one devtools tab (or one API call with
a staff token) away from plain view, including for the lowest-privilege
`agent` role.

Masking here instead means the raw number never leaves the backend at all.
Nothing is lost by doing so: outbound messages are addressed with
`Contact.external_id`, not this column (see app/channels/*), so no code path
needs the unmasked value on the client.
"""

import re

# UAE's country code is 3 digits — every contact in this workspace is +971.
# A generic 1-3 digit match would greedily take the first digit of the actual
# number as part of the country code and under-mask it, so the specific
# pattern is tried first. Mirrors the frontend helper exactly.
_UAE = re.compile(r"^(\+971)[\s-]*(.+)$")
_GENERIC = re.compile(r"^(\+\d{1,3})[\s-]*(.+)$")


def mask_phone_number(phone_number: str | None) -> str | None:
    """`+971501111111` -> `+971 XXXXXXXXX`. Returns None/unchanged for
    anything that isn't a recognisable international number."""
    if not phone_number:
        return phone_number
    match = _UAE.match(phone_number) or _GENERIC.match(phone_number)
    if not match:
        return phone_number
    country_code, rest = match.group(1), match.group(2)
    return f"{country_code} {'X' * len(re.sub(r'[\s-]', '', rest))}"
