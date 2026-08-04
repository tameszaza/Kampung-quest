import type { QuestProposal } from "@/server/domain/schemas";

/**
 * Builds a provider-neutral prompt from the safe, already validated quest
 * proposal. Never include member names, contact details, or other identity
 * data in an image prompt.
 */
export function buildQuestImagePrompt(
  quest: QuestProposal["quest"],
  variationKey = "",
): string {
  const directions = [
    "Use a gentle sunlit garden gathering with a small handmade detail.",
    "Use a warm community-table scene with expressive hands and natural movement.",
    "Use a calm neighbourhood outdoor scene with a distinctive seasonal colour accent.",
    "Use a cosy indoor workshop scene with clear, friendly visual storytelling.",
    "Use a playful but dignified intergenerational moment with an unexpected viewpoint.",
  ];
  const direction = directions[hashText(`${quest.title}:${quest.sharedGoal}:${variationKey}`) % directions.length];
  return [
    "Create one original 16:9 editorial illustration for a community activity thumbnail.",
    "Show respectful, diverse older adults enjoying a safe, welcoming activity together.",
    direction,
    "Make the composition visually distinct and specific to this quest, not generic stock photography.",
    "Use warm natural light, high contrast, uncluttered shapes, and an optimistic Senior Quest feel.",
    "Do not include text, lettering, logos, UI, watermarks, personal data, or medical imagery.",
    `Activity title: ${limitText(quest.title, 120)}`,
    `Shared goal: ${limitText(quest.sharedGoal, 180)}`,
    `Description: ${limitText(quest.description, 280)}`,
  ].join("\n");
}

export function hashText(value: string): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return hash;
}

function limitText(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f]/g, " ").slice(0, max).trim();
}
