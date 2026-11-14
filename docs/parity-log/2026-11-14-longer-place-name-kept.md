## 14 Nov 2026: LONGER_PLACE_NAME_KEPT stays Sunny-only

Gate-Sunny's #936 probes (non-blocking) and QA's ruling: the Observation of Offense cut a city out of a longer place
name ("at lincoln street fair" → "street fair", "at the lincoln zoo" → "zoo", "at the grand island fair" → "fair", "at
lincoln southeast high" → "southeast high") and a place out of the sentence it was the point of ("she was at omaha of
all places" → "she was of all places", "she was at omaha and left early" → "she was and left early"). With
LONGER_PLACE_NAME_KEPT_ENABLED (default off) `ai/remap-incident.ts` withoutPlace keeps them: a salon word counts as part
of a longer name only when the longer phrase is that salon, more words continue a place name (zoo, fair, southeast …),
and a place straight after "was" with "and"/"but"/"or"/"of" after it stays. A place that is only where it happened ("she
was late at omaha today", "… at kearney - no call no show") still leaves the account.

Sibling app: not needed. Checked on Ask Bubbles main 2d83917d (production flags, an Admin): "she was at kearney street
fair instead of her shift" and "… at grand island street fair …" keep every word on the Issue, and no store is read
from them; its account reader does not cut a store out of the account this way.
