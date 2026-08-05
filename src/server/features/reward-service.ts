import type { EventActivityCard } from "@/server/domain/event-coordination";

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
}

export interface RewardEarning {
  runId: string;
  title: string;
  points: number;
}

export interface RewardSummary {
  balance: number;
  lifetimePoints: number;
  completedActivityCount: number;
  pointsPerCompletedActivity: number;
  pointsUntilNextReward: number;
  earnings: RewardEarning[];
  offers: RewardOffer[];
}

export const rewardOffers: RewardOffer[] = [
  {
    offerId: "sunrise-cafe-set",
    company: "Sunrise Café",
    title: "Hot drink and toast set",
    description: "Enjoy a simple breakfast set at participating neighbourhood outlets.",
    pointsCost: 250,
    category: "Food & drink",
    initials: "SC",
    tone: "amber",
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
  },
];

export function buildRewardSummary(completedActivities: EventActivityCard[]): RewardSummary {
  const uniqueActivities = [...new Map(completedActivities.map((activity) => [activity.runId, activity])).values()];
  const earnings = uniqueActivities.map((activity) => ({
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
    pointsPerCompletedActivity: POINTS_PER_COMPLETED_ACTIVITY,
    pointsUntilNextReward: nextOffer ? nextOffer.pointsCost - balance : 0,
    earnings,
    offers: rewardOffers,
  };
}
