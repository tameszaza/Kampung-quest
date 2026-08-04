import type { QuestImageInput, QuestImageAgent, QuestImageResult } from "@/server/agents/quest-image-agent";
import { hashText } from "@/server/agents/quest-image-prompt";

const PALETTES = [
  ["#e7f7ef", "#8ed8ba", "#0b795e", "#f8c66b"],
  ["#e8f3fb", "#9ccceb", "#176c8f", "#f5b87b"],
  ["#f7efe5", "#e8bb8c", "#8d4e37", "#8ec9ad"],
  ["#f1ecfb", "#b9a6e2", "#62418a", "#f1c16f"],
  ["#edf4e2", "#b9d895", "#47733c", "#e3a56b"],
] as const;

/**
 * A zero-cost, deterministic thumbnail. It is intentionally an illustration
 * rather than a stock photo, so every quest still has a unique, safe visual
 * when a remote model is unavailable or out of quota.
 */
export class LocalQuestThumbnailAgent implements QuestImageAgent {
  async generate({ quest, variationKey }: QuestImageInput): Promise<QuestImageResult | null> {
    const seed = hashText(`${quest.title}:${quest.sharedGoal}:${quest.description}:${variationKey}`);
    const palette = PALETTES[seed % PALETTES.length];
    const sunX = 150 + (seed % 260);
    const peopleOffset = 80 + (seed % 70);
    const scene = quest.questType === "learning" ? "learning" : quest.questType === "conversation" ? "conversation" : "activity";
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="576" viewBox="0 0 1024 576" role="img" aria-label="Illustrated community activity">`,
      `<defs><linearGradient id="sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette[0]}"/><stop offset="1" stop-color="${palette[1]}"/></linearGradient><linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette[1]}"/><stop offset="1" stop-color="${palette[0]}"/></linearGradient></defs>`,
      `<rect width="1024" height="576" fill="url(#sky)"/>`,
      `<circle cx="${sunX}" cy="128" r="72" fill="${palette[3]}" opacity=".9"/>`,
      `<path d="M0 360 Q180 225 350 360 T700 345 T1024 350 V576 H0Z" fill="${palette[2]}" opacity=".52"/>`,
      `<path d="M0 408 Q220 318 430 410 T760 390 T1024 410 V576 H0Z" fill="url(#ground)"/>`,
      `<path d="M390 576 Q455 430 512 390 Q570 435 650 576Z" fill="#fff" opacity=".32"/>`,
      `<g fill="${palette[2]}" opacity=".78"><circle cx="${180 + peopleOffset}" cy="356" r="48"/><circle cx="${370 + peopleOffset}" cy="345" r="44"/><circle cx="${565 + peopleOffset}" cy="354" r="47"/></g>`,
      `<g fill="${palette[3]}" opacity=".9"><path d="M${122 + peopleOffset} 410 q60-50 120 0 v95 h-120z"/><path d="M${326 + peopleOffset} 400 q56-46 112 0 v105 h-112z"/><path d="M${520 + peopleOffset} 408 q60-50 120 0 v97 h-120z"/></g>`,
      `<g fill="#fff" opacity=".9"><circle cx="${204 + peopleOffset}" cy="348" r="13"/><circle cx="${392 + peopleOffset}" cy="338" r="12"/><circle cx="${588 + peopleOffset}" cy="347" r="13"/></g>`,
      `<g fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" opacity=".85"><path d="M780 165 q42-38 84 0 q-42 38-84 0Z"/><path d="M822 132 v66"/></g>`,
      scene === "learning"
        ? `<g fill="${palette[2]}" opacity=".92"><rect x="720" y="300" width="145" height="94" rx="16"/><path d="M742 325h100M742 350h70" stroke="#fff" stroke-width="10" stroke-linecap="round"/></g>`
        : scene === "conversation"
          ? `<g fill="#fff" opacity=".9"><rect x="720" y="300" width="150" height="90" rx="28"/><path d="m752 390-20 28 42-20" fill="#fff"/><circle cx="760" cy="344" r="7" fill="${palette[2]}"/><circle cx="795" cy="344" r="7" fill="${palette[2]}"/><circle cx="830" cy="344" r="7" fill="${palette[2]}"/></g>`
          : `<g fill="${palette[3]}" opacity=".95"><circle cx="790" cy="350" r="52"/><path d="M760 350h60M790 320v60" stroke="#fff" stroke-width="10" stroke-linecap="round"/></g>`,
      `</svg>`,
    ].join("");
    return { bytes: Buffer.from(svg), mimeType: "image/svg+xml", model: "local-quest-thumbnail" };
  }
}
