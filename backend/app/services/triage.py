"""Rule-based triage priority for potential defects.

This is a queue-ordering aid for human reviewers, not an airworthiness assessment.
Rules (mirrored in frontend/src/utils/triage.ts):
  high   - crack with confidence >= 0.80, or any finding a reviewer CONFIRMED as crack
  medium - corrosion >= 0.75, dent >= 0.85, or crack below 0.80
  low    - everything else
"""
from __future__ import annotations


def triage_priority(category: str, confidence: float) -> str:
    if category == "crack":
        return "high" if confidence >= 0.80 else "medium"
    if category == "corrosion" and confidence >= 0.75:
        return "medium"
    if category == "dent" and confidence >= 0.85:
        return "medium"
    return "low"
