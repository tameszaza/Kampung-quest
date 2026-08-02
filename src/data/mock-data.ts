import type { Invite, MessageThread, Need, Quest } from "@/types/quest";

export const quests: Quest[] = [
  {
    slug: "healthy-cooking-lunch-together",
    title: "Healthy Cooking Lunch Together",
    description: "Let's cook simple, healthy low-sodium dishes and enjoy lunch together!",
    image: "/assets/cooking.jpg",
    badge: "NEW",
    people: "3–4 people",
    dateLabel: "Tomorrow",
    dateLong: "Tomorrow, Aug 5, 2026",
    time: "11:30 AM – 1:30 PM",
    location: "Sunny Community Center, Kitchen Room",
    setting: "Indoor",
    host: {
      name: "Anne",
      image: "/assets/profile-anne.jpg",
    },
    joined: 3,
    capacity: 4,
  },
  {
    slug: "morning-walk-and-chat",
    title: "Morning Walk and Chat",
    description: "Enjoy a gentle morning walk and an easy conversation with neighbours.",
    image: "/assets/walk.jpg",
    badge: "NEW",
    people: "2–6 people",
    dateLabel: "Aug 8",
    dateLong: "Saturday, Aug 8, 2026",
    time: "7:00 AM – 8:30 AM",
    location: "Neighbourhood Park",
    setting: "Outdoor",
    host: {
      name: "David",
      image: "/assets/profile-david.jpg",
    },
    joined: 4,
    capacity: 6,
  },
  {
    slug: "digital-help-share-and-learn",
    title: "Digital Help Share & Learn",
    shortTitle: "Digital Help",
    description: "Bring a phone or tablet and learn useful digital skills together at a relaxed pace.",
    image: "/assets/digital-help.jpg",
    people: "2–4 people",
    dateLabel: "Aug 12",
    dateLong: "Wednesday, Aug 12, 2026",
    time: "2:00 PM – 3:30 PM",
    location: "Community Room B",
    setting: "Indoor",
    host: {
      name: "John",
      image: "/assets/profile-john.jpg",
    },
    joined: 2,
    capacity: 4,
  },
];

export const activeNeeds: Need[] = [
  {
    id: "companionship-lunch",
    emoji: "👨",
    title: "Companionship during lunch",
    preference: "Small group preferred · 2–4 people",
    schedule: "Today · 11:00 AM – 2:00 PM",
    status: "Active",
  },
  {
    id: "healthy-cooking",
    emoji: "👵",
    title: "Learn healthy cooking",
    preference: "Indoor activity preferred",
    schedule: "Aug 10 · 10:00 AM – 1:00 PM",
    status: "Active",
  },
  {
    id: "gentle-walk",
    emoji: "🚶",
    title: "Walk in the park & gentle exercise",
    preference: "Morning preferred",
    schedule: "Aug 12 · 7:00 AM – 9:00 AM",
    status: "Active",
  },
];

export const pastNeeds: Need[] = [];

export const invites: Invite[] = [
  {
    id: "invite-cooking-anne",
    questSlug: "healthy-cooking-lunch-together",
    from: "Anne",
  },
  {
    id: "invite-walk-david",
    questSlug: "morning-walk-and-chat",
    from: "David",
  },
];

export const messageThreads: MessageThread[] = [
  {
    id: "anne-host",
    name: "Anne (Host)",
    image: "/assets/profile-anne.jpg",
    preview: "Looking forward to cooking together! 😊",
    time: "10:30 AM",
    unread: 2,
  },
  {
    id: "david",
    name: "David",
    image: "/assets/profile-david.jpg",
    preview: "The weather will be good for our walk ☁️",
    time: "9:15 AM",
  },
  {
    id: "cooking-group",
    name: "Cooking Group",
    image: "/assets/profile-group.jpg",
    preview: "Maria: I can bring some fruits!",
    time: "Yesterday",
    unread: 3,
  },
  {
    id: "tech-learning",
    name: "Tech Learning",
    image: "/assets/profile-john.jpg",
    preview: "John: I'll bring my tablet.",
    time: "Yesterday",
  },
  {
    id: "community-team",
    name: "Community Team",
    image: "/assets/onboarding-seniors.png",
    preview: "Reminder: Your quest starts tomorrow.",
    time: "Jul 31",
  },
];

export function getQuest(slug: string): Quest | undefined {
  return quests.find((quest) => quest.slug === slug);
}
