import type { EventActivityCard } from "@/server/domain/event-coordination";
import type { EventRewardEntry } from "@/server/domain/event-tasks";

export const POINTS_PER_COMPLETED_ACTIVITY = 100;

export interface RewardOffer {
  offerId: string;
  company: string;
  title: string;
  description: string;
  pointsCost: number;
  category: string;
  initials: string;
  tone: "mint" | "amber" | "blue" | "rose" | "violet" | "green";
  value: string;
  validUntil: string;
  locations: string;
  partnerDescription: string;
  redemptionSteps: string[];
  heroImage?: string;
  partnerLogoImage?: string;
  outletImage?: string;
  rewardBadgeImage?: string;
  partnerBadgeImage?: string;
  menuImages?: string[];
}

export interface RewardEarning {
  earningId: string;
  runId: string;
  title: string;
  points: number;
  taskId?: string;
  difficulty?: "easy" | "medium" | "hard";
  earnedAt?: string;
}

export interface RewardSummary {
  balance: number;
  lifetimePoints: number;
  completedActivityCount: number;
  approvedTaskCount: number;
  pointsPerCompletedActivity: number;
  pointsUntilNextReward: number;
  earnings: RewardEarning[];
  offers: RewardOffer[];
}

export const rewardOffers: RewardOffer[] = [
  {
    offerId: "sunrise-cafe-set",
    company: "Toast Box",
    title: "Free Drink or Snack Set",
    description: "Choose one drink and one snack from the selected menu at participating neighbourhood outlets.",
    pointsCost: 250,
    category: "Food & drink",
    initials: "SC",
    tone: "amber",
    value: "One drink and one snack set",
    validUntil: "31 Dec 2026",
    locations: "Selected neighbourhood outlets",
    partnerDescription: "Toast Box brings familiar food, drinks, and a welcoming café setting together for a relaxed community break.",
    redemptionSteps: ["Complete or attend any Senior Quest activity.", "Open this deal and tap Redeem when redemption launches.", "Show the reward code to the café team.", "Enjoy your drink or snack set."],
    heroImage: "/assets/hero_breakfast_set.png",
    partnerLogoImage: "/assets/partner_logo.png",
    outletImage: "/assets/partner_outlet.png",
    rewardBadgeImage: "/assets/reward_unlocked_badge.png",
    partnerBadgeImage: "/assets/official_partner_badge.png",
    menuImages: ["/assets/menu_set_meal.png", "/assets/menu_hot_drink.png", "/assets/menu_noodle_meal.png"],
  },
  {
    offerId: "green-garden-credit",
    company: "Green Garden Centre",
    title: "$5 gardening credit",
    description: "Use towards herbs, seeds, or small gardening supplies.",
    pointsCost: 350,
    category: "Hobbies",
    initials: "GG",
    tone: "green",
    value: "$5 off gardening supplies",
    validUntil: "31 Dec 2026",
    locations: "Participating garden centres",
    partnerDescription: "Green Garden Centre helps neighbours keep growing with practical supplies for balconies, windowsills, and community gardens.",
    redemptionSteps: ["Complete or attend any Senior Quest activity.", "Choose this gardening credit from your available rewards.", "Show the reward code at a participating centre.", "Use the credit on eligible gardening supplies."],
    outletImage: "/assets/garden_centre_interior.jpg",
    menuImages: [
      "/assets/gardening_tools_flatlay.jpg",
      "/assets/planting_herb_seedling.jpg",
      "/assets/potted_herbs_selection.jpg",
    ],
  },
  {
    offerId: "community-cinema-ticket",
    company: "Community Cinema",
    title: "Weekday movie ticket",
    description: "One standard weekday admission at selected community screenings.",
    pointsCost: 400,
    category: "Leisure",
    initials: "CC",
    tone: "violet",
    value: "One weekday cinema ticket",
    validUntil: "30 Nov 2026",
    locations: "Selected community screenings",
    partnerDescription: "Community Cinema brings people together for affordable weekday screenings and relaxed shared experiences.",
    redemptionSteps: ["Complete or attend any Senior Quest activity.", "Select a weekday screening after redemption opens.", "Show the reward code at the cinema desk.", "Enjoy the film with your community."],
  },
  {
    offerId: "neighbourhood-grocer-voucher",
    company: "Neighbourhood Grocer",
    title: "$5 grocery voucher",
    description: "Save on fresh food and daily essentials at participating stores.",
    pointsCost: 500,
    category: "Daily essentials",
    initials: "NG",
    tone: "mint",
    value: "$5 toward fresh food and essentials",
    validUntil: "31 Dec 2026",
    locations: "Participating neighbourhood stores",
    partnerDescription: "Neighbourhood Grocer supports everyday wellbeing with fresh food, household essentials, and friendly local service.",
    redemptionSteps: ["Complete or attend any Senior Quest activity.", "Open this voucher from your rewards page.", "Show the reward code at checkout.", "Use the credit on eligible items."],
  },
  {
    offerId: "city-rides-credit",
    company: "City Rides",
    title: "$5 ride credit",
    description: "A little help getting to your next community activity.",
    pointsCost: 600,
    category: "Transport",
    initials: "CR",
    tone: "blue",
    value: "$5 toward a community trip",
    validUntil: "31 Oct 2026",
    locations: "Within participating service areas",
    partnerDescription: "City Rides helps members travel to community activities, appointments, and the people who matter to them.",
    redemptionSteps: ["Complete or attend any Senior Quest activity.", "Choose the ride credit when redemption opens.", "Apply the reward code to an eligible trip.", "Travel safely to your next destination."],
  },
  {
    offerId: "wellness-pharmacy-voucher",
    company: "Wellness Pharmacy",
    title: "$8 wellbeing voucher",
    description: "Use on selected personal care and wellbeing essentials.",
    pointsCost: 700,
    category: "Wellbeing",
    initials: "WP",
    tone: "rose",
    value: "$8 toward selected wellbeing essentials",
    validUntil: "31 Dec 2026",
    locations: "Participating Wellness Pharmacy outlets",
    partnerDescription: "Wellness Pharmacy offers approachable personal care and wellbeing essentials for everyday routines.",
    redemptionSteps: ["Complete or attend any Senior Quest activity.", "Open this wellbeing voucher after redemption launches.", "Show the reward code to staff.", "Use it on selected eligible products."],
  },
];

export function buildRewardSummary(completedActivities: EventActivityCard[]): RewardSummary {
  const uniqueActivities = [...new Map(completedActivities.map((activity) => [activity.runId, activity])).values()];
  const earnings = uniqueActivities.map((activity) => ({
    earningId: `activity:${activity.runId}`,
    runId: activity.runId,
    title: activity.title,
    points: POINTS_PER_COMPLETED_ACTIVITY,
  }));
  const balance = earnings.reduce((total, earning) => total + earning.points, 0);
  const nextOffer = [...rewardOffers]
    .sort((left, right) => left.pointsCost - right.pointsCost)
    .find((offer) => offer.pointsCost > balance);

  return {
    balance,
    lifetimePoints: balance,
    completedActivityCount: uniqueActivities.length,
    approvedTaskCount: 0,
    pointsPerCompletedActivity: POINTS_PER_COMPLETED_ACTIVITY,
    pointsUntilNextReward: nextOffer ? nextOffer.pointsCost - balance : 0,
    earnings,
    offers: rewardOffers,
  };
}

export function buildTaskRewardSummary(entries: Array<EventRewardEntry & {
  taskTitle: string;
  eventTitle: string;
  difficulty: "easy" | "medium" | "hard";
}>): RewardSummary {
  const earnings = entries.map((entry) => ({
    earningId: entry.entryId,
    runId: entry.runId,
    title: `${entry.eventTitle} · ${entry.taskTitle}`,
    points: entry.points,
    taskId: entry.taskId,
    difficulty: entry.difficulty,
    earnedAt: entry.createdAt,
  }));
  const balance = earnings.reduce((total, earning) => total + earning.points, 0);
  const nextOffer = [...rewardOffers]
    .sort((left, right) => left.pointsCost - right.pointsCost)
    .find((offer) => offer.pointsCost > balance);
  return {
    balance,
    lifetimePoints: balance,
    completedActivityCount: 0,
    approvedTaskCount: entries.filter((entry) => entry.kind === "task_award").length,
    pointsPerCompletedActivity: 0,
    pointsUntilNextReward: nextOffer ? nextOffer.pointsCost - balance : 0,
    earnings,
    offers: rewardOffers,
  };
}

export function buildRewardSummaryWithTaskEntries(
  completedActivities: EventActivityCard[],
  entries: Array<EventRewardEntry & {
    taskTitle: string;
    eventTitle: string;
    difficulty: "easy" | "medium" | "hard";
  }>,
  taskPlanRunIds: ReadonlySet<string>,
): RewardSummary {
  const legacySummary = buildRewardSummary(
    completedActivities.filter((activity) => !taskPlanRunIds.has(activity.runId)),
  );
  const taskSummary = buildTaskRewardSummary(entries);
  const earnings = [...legacySummary.earnings, ...taskSummary.earnings]
    .sort((left, right) => (right.earnedAt ?? "").localeCompare(left.earnedAt ?? ""));
  const balance = earnings.reduce((total, earning) => total + earning.points, 0);
  const nextOffer = [...rewardOffers]
    .sort((left, right) => left.pointsCost - right.pointsCost)
    .find((offer) => offer.pointsCost > balance);
  return {
    balance,
    lifetimePoints: balance,
    completedActivityCount: legacySummary.completedActivityCount,
    approvedTaskCount: taskSummary.approvedTaskCount,
    pointsPerCompletedActivity: POINTS_PER_COMPLETED_ACTIVITY,
    pointsUntilNextReward: nextOffer ? nextOffer.pointsCost - balance : 0,
    earnings,
    offers: rewardOffers,
  };
}
