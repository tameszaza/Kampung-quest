"use client";

import type { AccessibilityPreferences } from "@/server/identity/types";

export const emptyAccessibilityPreferences: AccessibilityPreferences = {
  stairsAllowed: null,
  maximumDistanceM: null,
  language: null,
};

export function AccessibilityPreferenceFields({
  value,
  onChange,
  compact = false,
}: {
  value: AccessibilityPreferences;
  onChange: (value: AccessibilityPreferences) => void;
  compact?: boolean;
}) {
  return (
    <fieldset className={`accessibility-preferences${compact ? " accessibility-preferences-compact" : ""}`}>
      <legend>Accessibility & matching (optional)</legend>
      <p>Save these once and Senior Quest can reuse them in future quest chats. Choose “Ask me” any time to remove a default.</p>
      <label>
        <span>Stairs and steps</span>
        <select
          value={value.stairsAllowed === null ? "" : String(value.stairsAllowed)}
          onChange={(event) => onChange({ ...value, stairsAllowed: event.target.value === "" ? null : event.target.value === "true" })}
        >
          <option value="">Ask me when needed</option>
          <option value="true">Stairs are comfortable</option>
          <option value="false">No stairs, please</option>
        </select>
      </label>
      <label>
        <span>Maximum walking distance</span>
        <select
          value={value.maximumDistanceM === null ? "" : String(value.maximumDistanceM)}
          onChange={(event) => onChange({ ...value, maximumDistanceM: event.target.value ? Number(event.target.value) : null })}
        >
          <option value="">Ask me when needed</option>
          <option value="500">Up to 500 metres</option>
          <option value="1000">Up to 1 kilometre</option>
          <option value="2000">Up to 2 kilometres</option>
        </select>
      </label>
      <label>
        <span>Quest language</span>
        <select value={value.language ?? ""} onChange={(event) => onChange({ ...value, language: event.target.value || null })}>
          <option value="">Ask me when needed</option>
          <option>English</option>
          <option>Chinese</option>
          <option>Malay</option>
          <option>Tamil</option>
        </select>
      </label>
    </fieldset>
  );
}
