export type Quest = {
  slug: string;
  title: string;
  shortTitle?: string;
  description: string;
  image: string;
  badge?: string;
  people: string;
  dateLabel: string;
  dateLong: string;
  time: string;
  location: string;
  setting: "Indoor" | "Outdoor";
  host: {
    name: string;
    image: string;
  };
  joined?: number;
  capacity?: number;
};

export type Need = {
  id: string;
  emoji: string;
  title: string;
  preference: string;
  schedule: string;
  status: "Active" | "Past";
};

export type Invite = {
  id: string;
  questSlug: string;
  from: string;
};

export type MessageThread = {
  id: string;
  name: string;
  image: string;
  preview: string;
  time: string;
  unread?: number;
};
