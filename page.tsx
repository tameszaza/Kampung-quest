"use client";

import { useMemo, useState } from "react";

type Page =
  | "onboarding"
  | "home"
  | "needs"
  | "quests"
  | "detail"
  | "invites"
  | "myquests"
  | "messages"
  | "profile"
  | "settings";

type IconName =
  | "home"
  | "quests"
  | "plus"
  | "message"
  | "profile"
  | "menu"
  | "back"
  | "share"
  | "heart"
  | "calendar"
  | "clock"
  | "pin"
  | "people"
  | "chevron"
  | "gift"
  | "settings"
  | "camera"
  | "needs"
  | "invite"
  | "connections"
  | "badge"
  | "bell"
  | "privacy"
  | "blocked"
  | "help"
  | "shield"
  | "edit"
  | "close"
  | "check";

function Icon({ name, size = 22, strokeWidth = 1.8 }: { name: IconName; size?: number; strokeWidth?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "home":
      return <svg {...common}><path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 9.8V21h13V9.8"/><path d="M9.5 21v-6h5v6"/></svg>;
    case "quests":
      return <svg {...common}><path d="M7 3.5h10v4H7z"/><path d="M5 7.5h14v13H5z"/><path d="M9 12h6M9 16h4"/></svg>;
    case "plus":
      return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
    case "message":
      return <svg {...common}><path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/></svg>;
    case "profile":
      return <svg {...common}><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>;
    case "menu":
      return <svg {...common}><path d="M4 7h16M4 12h16M4 17h11"/></svg>;
    case "back":
      return <svg {...common}><path d="m15 18-6-6 6-6"/></svg>;
    case "share":
      return <svg {...common}><circle cx="18" cy="5" r="2.2"/><circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="19" r="2.2"/><path d="m8 11 8-5M8 13l8 5"/></svg>;
    case "heart":
      return <svg {...common}><path d="M20.8 4.9a5.5 5.5 0 0 0-7.8 0L12 6l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.3a5.5 5.5 0 0 0 0-7.8Z"/></svg>;
    case "calendar":
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>;
    case "clock":
      return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case "pin":
      return <svg {...common}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>;
    case "people":
      return <svg {...common}><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M14.5 15.5a5 5 0 0 1 6.5 4.5"/></svg>;
    case "chevron":
      return <svg {...common}><path d="m9 18 6-6-6-6"/></svg>;
    case "gift":
      return <svg {...common}><path d="M3 9h18v12H3zM2 5h20v4H2zM12 5v16"/><path d="M12 5H8.5a2.5 2.5 0 1 1 2.3-3.4L12 5Zm0 0h3.5a2.5 2.5 0 1 0-2.3-3.4L12 5Z"/></svg>;
    case "settings":
      return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.64 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.64a1.7 1.7 0 0 0 1-1.56V3h4v.08A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.36 9a1.7 1.7 0 0 0 1.56 1H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/></svg>;
    case "camera":
      return <svg {...common}><path d="M4 7h3l1.5-2h7L17 7h3v13H4z"/><circle cx="12" cy="13" r="4"/></svg>;
    case "needs":
      return <svg {...common}><path d="M4 12h4l2-7 4 14 2-7h4"/></svg>;
    case "invite":
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>;
    case "connections":
      return <svg {...common}><circle cx="8" cy="8" r="3"/><circle cx="17" cy="7" r="2"/><path d="M2.5 20a5.5 5.5 0 0 1 11 0M14 14.5a4.5 4.5 0 0 1 7 3.75"/></svg>;
    case "badge":
      return <svg {...common}><circle cx="12" cy="9" r="6"/><path d="m8.5 14-1 7 4.5-2 4.5 2-1-7"/></svg>;
    case "bell":
      return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M10 20h4"/></svg>;
    case "privacy":
      return <svg {...common}><path d="M12 2 4 5v6c0 5 3.4 8.6 8 11 4.6-2.4 8-6 8-11V5z"/><path d="M9 12h6M12 9v6"/></svg>;
    case "blocked":
      return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/></svg>;
    case "help":
      return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.6 2.25C12.3 11.7 12 12.2 12 13v.5M12 17h.01"/></svg>;
    case "shield":
      return <svg {...common}><path d="M12 2 4 5v6c0 5 3.4 8.6 8 11 4.6-2.4 8-6 8-11V5z"/><path d="m9 12 2 2 4-5"/></svg>;
    case "edit":
      return <svg {...common}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg>;
    case "close":
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18"/></svg>;
    case "check":
      return <svg {...common}><path d="m5 12 4 4L19 6"/></svg>;
  }
}

function AppStatusBar() {
  return (
    <div className="status-bar" aria-hidden="true">
      <span>9:41</span>
      <div className="status-icons">
        <span className="cell-bars"><i/><i/><i/><i/></span>
        <span className="wifi-mark"/>
        <span className="battery-mark"><i/></span>
      </div>
    </div>
  );
}

function Header({ title, back, right }: { title: string; back?: () => void; right?: React.ReactNode }) {
  return (
    <header className="app-header">
      <button className={`icon-button ${back ? "" : "header-placeholder"}`} onClick={back} aria-label="Go back">
        {back ? <Icon name="back" /> : null}
      </button>
      <h1>{title}</h1>
      <div className="header-action">{right ?? <span />}</div>
    </header>
  );
}

function BottomNav({ page, navigate, onCreate }: { page: Page; navigate: (page: Page) => void; onCreate: () => void }) {
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      <button className={page === "home" ? "active" : ""} onClick={() => navigate("home")}><Icon name="home" size={23}/><span>Home</span></button>
      <button className={["quests", "detail", "invites", "myquests", "needs"].includes(page) ? "active" : ""} onClick={() => navigate("quests")}><Icon name="quests" size={22}/><span>Quests</span></button>
      <button className="create-button" onClick={onCreate} aria-label="Create a quest"><Icon name="plus" size={27}/></button>
      <button className={page === "messages" ? "active" : ""} onClick={() => navigate("messages")}><Icon name="message" size={22}/><span>Messages</span></button>
      <button className={["profile", "settings"].includes(page) ? "active" : ""} onClick={() => navigate("profile")}><Icon name="profile" size={22}/><span>Profile</span></button>
    </nav>
  );
}

function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (tab: string) => void }) {
  return <div className="tabs">{tabs.map((tab) => <button key={tab} className={active === tab ? "active" : ""} onClick={() => onChange(tab)}>{tab}</button>)}</div>;
}

function MetaRow({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return <div className="meta-row"><Icon name={icon} size={17}/><span>{children}</span></div>;
}

function QuestImage({ src, badge, className = "" }: { src: string; badge?: string; className?: string }) {
  return <div className={`quest-image ${className}`}><img src={src} alt=""/>{badge ? <span className="image-badge">{badge}</span> : null}</div>;
}

function Onboarding({ onStart }: { onStart: () => void }) {
  return (
    <div className="screen onboarding-screen">
      <AppStatusBar />
      <div className="onboarding-content">
        <div className="brand-mark" aria-label="Senior Quest logo"><span className="brand-dot left"/><span className="brand-dot right"/><span className="brand-heart">♥</span></div>
        <h1>Senior Quest</h1>
        <p className="brand-subtitle">Share. Connect. Enjoy Together.</p>
        <img className="onboarding-illustration" src="/assets/onboarding-seniors.png" alt="Two smiling senior neighbours"/>
        <h2>Let&apos;s create<br/>meaningful moments<br/>together.</h2>
        <p className="onboarding-copy">Join activities, share your skills,<br/>and make new friends nearby.</p>
        <div className="onboarding-actions">
          <button className="primary-button" onClick={onStart}>Get Started</button>
          <button className="secondary-button" onClick={onStart}>I Have an Account</button>
        </div>
        <div className="pager-dots"><span className="active"/><span/><span/></div>
      </div>
    </div>
  );
}

function HomeScreen({ navigate }: { navigate: (page: Page) => void }) {
  return (
    <div className="screen has-nav">
      <AppStatusBar />
      <div className="home-topbar">
        <button className="icon-button" aria-label="Open menu"><Icon name="menu"/></button>
        <img src="/assets/profile-maria.jpg" alt="Maria" className="avatar avatar-lg"/>
      </div>
      <main className="screen-content home-content">
        <p className="eyebrow">Good morning,</p>
        <h2 className="greeting">Maria! <span aria-hidden="true">👋</span></h2>

        <button className="invite-banner" onClick={() => navigate("invites")}>
          <span className="gift-icon"><Icon name="gift" size={31}/></span>
          <span><strong>You have 2 new<br/>quest invites</strong><em>View Invites</em></span>
        </button>

        <div className="section-heading"><h3>Recommended for You</h3><button onClick={() => navigate("quests")}>See all</button></div>
        <button className="home-quest-card" onClick={() => navigate("detail")}>
          <QuestImage src="/assets/cooking.jpg" badge="NEW"/>
          <div className="card-copy">
            <h4>Healthy Cooking<br/>Lunch Together</h4>
            <div className="compact-meta"><MetaRow icon="people">3–4 people</MetaRow><MetaRow icon="calendar">Tomorrow</MetaRow></div>
          </div>
        </button>
        <div className="carousel-dots"><span/><span className="active"/><span/></div>

        <div className="section-heading status-heading"><h3>Your Status</h3></div>
        <button className="status-card" onClick={() => navigate("needs")}><span>You&apos;re open to join quests</span><strong>Change</strong></button>
      </main>
    </div>
  );
}

function NeedsScreen({ navigate }: { navigate: (page: Page) => void }) {
  const [tab, setTab] = useState("Active");
  return (
    <div className="screen has-nav">
      <AppStatusBar />
      <Header title="My Needs" back={() => navigate("home")} right={<button className="round-add" aria-label="Add a need"><Icon name="plus" size={23}/></button>}/>
      <Tabs tabs={["Active", "Past"]} active={tab} onChange={setTab}/>
      <main className="screen-content list-content">
        {tab === "Active" ? <>
          <NeedCard emoji="👨" title="Companionship during lunch" detail="Small group preferred" meta="2–4 people" time="Today · 11:00 AM – 2:00 PM"/>
          <NeedCard emoji="👵" title="Learn healthy cooking" detail="Indoor activity preferred" meta="" time="Aug 10 · 10:00 AM – 1:00 PM"/>
          <NeedCard emoji="🚶" title="Walk in the park & gentle exercise" detail="Morning preferred" meta="" time="Aug 12 · 7:00 AM – 9:00 AM"/>
        </> : <EmptyState title="No past needs" copy="Needs you complete will appear here."/>}
      </main>
    </div>
  );
}

function NeedCard({ emoji, title, detail, meta, time }: { emoji: string; title: string; detail: string; meta: string; time: string }) {
  return <article className="need-card"><span className="need-emoji">{emoji}</span><div><h3>{title}</h3><p>{detail}</p>{meta ? <p>{meta}</p> : null}<p>{time}</p><strong>Active</strong></div></article>;
}

const questCards = [
  { title: "Healthy Cooking Lunch Together", src: "/assets/cooking.jpg", people: "3–4 people", time: "Tomorrow, 11:30 AM", place: "Indoor" },
  { title: "Morning Walk and Chat", src: "/assets/walk.jpg", people: "2–6 people", time: "Aug 8, 7:00 AM", place: "Outdoor" },
  { title: "Digital Help Share & Learn", src: "/assets/digital-help.jpg", people: "2–4 people", time: "Aug 12, 2:00 PM", place: "Community Room B" },
];

function QuestsScreen({ navigate }: { navigate: (page: Page) => void }) {
  const [saved, setSaved] = useState<string[]>([]);
  return (
    <div className="screen has-nav">
      <AppStatusBar />
      <Header title="Recommended Quests"/>
      <main className="screen-content quest-list-content">
        <p className="matched-copy">Matched for you <span aria-hidden="true">✨</span></p>
        {questCards.map((quest, index) => (
          <article className="quest-list-card" key={quest.title}>
            <button className="quest-card-main" onClick={() => navigate("detail")}>
              <QuestImage src={quest.src} badge={index < 2 ? "NEW" : undefined}/>
              <div className="quest-card-body"><h3>{quest.title}</h3><MetaRow icon="people">{quest.people}</MetaRow><MetaRow icon="calendar">{quest.time}</MetaRow><MetaRow icon="pin">{quest.place}</MetaRow></div>
            </button>
            <button className={`save-button ${saved.includes(quest.title) ? "saved" : ""}`} onClick={() => setSaved((current) => current.includes(quest.title) ? current.filter((item) => item !== quest.title) : [...current, quest.title])} aria-label="Save quest"><Icon name="heart" size={21}/></button>
          </article>
        ))}
      </main>
    </div>
  );
}

function DetailScreen({ navigate }: { navigate: (page: Page) => void }) {
  const [interested, setInterested] = useState(false);
  return (
    <div className="screen has-nav detail-screen">
      <AppStatusBar />
      <Header title="Quest Details" back={() => navigate("quests")} right={<button className="icon-button" aria-label="Share quest"><Icon name="share" size={21}/></button>}/>
      <main className="screen-content detail-content">
        <QuestImage src="/assets/cooking.jpg" badge="NEW" className="detail-image"/>
        <section className="detail-body">
          <h2>Healthy Cooking<br/>Lunch Together</h2>
          <p className="detail-description">Let&apos;s cook simple, healthy low-sodium dishes and enjoy lunch together!</p>
          <div className="detail-facts">
            <DetailFact icon="calendar" label="Date"><strong>Tomorrow, Aug 5, 2026</strong></DetailFact>
            <DetailFact icon="clock" label="Time"><strong>11:30 AM – 1:30 PM</strong></DetailFact>
            <DetailFact icon="pin" label="Location"><strong>Sunny Community Center<br/>Kitchen Room</strong></DetailFact>
            <DetailFact icon="people" label="Group Size"><strong>3 – 4 people</strong></DetailFact>
            <div className="detail-fact"><img src="/assets/profile-anne.jpg" alt="Anne" className="avatar avatar-sm"/><div><span>Host</span><strong>Anne</strong></div></div>
          </div>
        </section>
      </main>
      <div className="sticky-action"><button className={`primary-button ${interested ? "confirmed" : ""}`} onClick={() => setInterested(true)}>{interested ? <><Icon name="check" size={20}/> Interest Sent</> : "I'm Interested"}</button></div>
    </div>
  );
}

function DetailFact({ icon, label, children }: { icon: IconName; label: string; children: React.ReactNode }) {
  return <div className="detail-fact"><Icon name={icon} size={21}/><div><span>{label}</span>{children}</div></div>;
}

function InvitesScreen({ navigate }: { navigate: (page: Page) => void }) {
  const [tab, setTab] = useState("Received");
  const [decisions, setDecisions] = useState<Record<string, "accepted" | "declined">>({});
  const invites = [
    { title: "Healthy Cooking Lunch Together", from: "Anne", time: "Tomorrow, 11:30 AM", src: "/assets/cooking.jpg" },
    { title: "Morning Walk and Chat", from: "David", time: "Aug 8, 7:00 AM", src: "/assets/walk.jpg" },
  ];
  return (
    <div className="screen has-nav">
      <AppStatusBar />
      <Header title="My Invites"/>
      <Tabs tabs={["Received", "Sent"]} active={tab} onChange={setTab}/>
      <main className="screen-content list-content invite-list">
        {tab === "Received" ? invites.map((invite) => {
          const decision = decisions[invite.title];
          return <article className="invite-card" key={invite.title}>
            <QuestImage src={invite.src} badge="New"/>
            <h3>{invite.title}</h3>
            <MetaRow icon="invite">From {invite.from}</MetaRow>
            <MetaRow icon="calendar">{invite.time}</MetaRow>
            {decision ? <div className={`decision-message ${decision}`}><Icon name="check" size={18}/>{decision === "accepted" ? "Quest accepted" : "Invite declined"}</div> : <div className="split-actions"><button className="secondary-button" onClick={() => setDecisions((value) => ({ ...value, [invite.title]: "declined" }))}>Decline</button><button className="primary-button" onClick={() => setDecisions((value) => ({ ...value, [invite.title]: "accepted" }))}>Accept</button></div>}
          </article>;
        }) : <EmptyState title="No sent invites" copy="Invites you send will appear here."/>}
      </main>
    </div>
  );
}

function MyQuestsScreen({ navigate }: { navigate: (page: Page) => void }) {
  const [tab, setTab] = useState("Upcoming");
  return (
    <div className="screen has-nav">
      <AppStatusBar />
      <Header title="My Quests"/>
      <Tabs tabs={["Upcoming", "Past"]} active={tab} onChange={setTab}/>
      <main className="screen-content list-content my-quest-list">
        {tab === "Upcoming" ? questCards.slice(0, 2).map((quest, index) => <button className="joined-card" key={quest.title} onClick={() => navigate("detail")}>
          <QuestImage src={quest.src} badge="UPCOMING"/>
          <div className="joined-card-body"><h3>{quest.title}</h3><MetaRow icon="calendar">{quest.time}</MetaRow><MetaRow icon="pin">{index === 0 ? "Sunny Community Center" : "Community Room B"}</MetaRow><div className="joined-footer"><span className="mini-avatars"><img src="/assets/profile-anne.jpg" alt=""/><img src="/assets/profile-david.jpg" alt=""/></span><span>{index === 0 ? "3 / 4 joined" : "2 / 4 joined"}</span><Icon name="chevron" size={19}/></div></div>
        </button>) : <EmptyState title="No past quests" copy="Completed quests will appear here."/>}
      </main>
    </div>
  );
}

const messages = [
  { name: "Anne (Host)", text: "Looking forward to cooking together! 😊", time: "10:30 AM", avatar: "/assets/profile-anne.jpg", count: 2 },
  { name: "David", text: "The weather will be good for our walk ☁️", time: "9:15 AM", avatar: "/assets/profile-david.jpg" },
  { name: "Cooking Group", text: "Maria: I can bring some fruits!", time: "Yesterday", avatar: "/assets/profile-group.jpg", count: 3 },
  { name: "Tech Learning", text: "John: I’ll bring my tablet.", time: "Yesterday", avatar: "/assets/profile-john.jpg" },
  { name: "Community Team", text: "Reminder: Your quest starts tomorrow.", time: "Jul 31", avatar: "/assets/onboarding-seniors.png" },
];

function MessagesScreen({ onCreate }: { onCreate: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="screen has-nav">
      <AppStatusBar />
      <Header title="Messages" right={<button className="round-add" aria-label="New message" onClick={onCreate}><Icon name="plus" size={23}/></button>}/>
      <main className="screen-content messages-list">
        {messages.map((message) => <button className="message-row" key={message.name} onClick={() => setSelected(message.name)}>
          <img src={message.avatar} alt="" className="avatar message-avatar"/>
          <span className="message-copy"><strong>{message.name}</strong><span>{message.text}</span></span>
          <span className="message-side"><time>{message.time}</time>{message.count ? <b>{message.count}</b> : null}</span>
        </button>)}
      </main>
      {selected ? <div className="toast" role="status">Opening conversation with {selected}</div> : null}
    </div>
  );
}

function ProfileScreen({ navigate }: { navigate: (page: Page) => void }) {
  return (
    <div className="screen has-nav">
      <AppStatusBar />
      <Header title="Profile" right={<button className="icon-button" onClick={() => navigate("settings")} aria-label="Open settings"><Icon name="settings" size={22}/></button>}/>
      <main className="screen-content profile-content">
        <div className="profile-photo-wrap"><img src="/assets/profile-maria.jpg" alt="Maria Santos" className="profile-photo"/><button aria-label="Change profile photo"><Icon name="camera" size={17}/></button></div>
        <h2>Maria Santos</h2><p>Senior Member</p>
        <div className="profile-stats"><div><strong>12</strong><span>Quests Joined</span></div><div><strong>8</strong><span>Connections</span></div><div><strong>3</strong><span>Hosting</span></div></div>
        <div className="menu-card">
          <MenuRow icon="needs" label="My Needs" onClick={() => navigate("needs")}/>
          <MenuRow icon="calendar" label="My Quests" onClick={() => navigate("myquests")}/>
          <MenuRow icon="invite" label="My Invites" onClick={() => navigate("invites")}/>
          <MenuRow icon="connections" label="My Connections"/>
          <MenuRow icon="badge" label="My Badges" last/>
        </div>
      </main>
    </div>
  );
}

function MenuRow({ icon, label, onClick, danger, last }: { icon: IconName; label: string; onClick?: () => void; danger?: boolean; last?: boolean }) {
  return <button className={`menu-row ${danger ? "danger" : ""} ${last ? "last" : ""}`} onClick={onClick}><Icon name={icon} size={20}/><span>{label}</span><Icon name="chevron" size={19}/></button>;
}

function SettingsScreen({ navigate }: { navigate: (page: Page) => void }) {
  const [toast, setToast] = useState<string | null>(null);
  const activate = (label: string) => setToast(`${label} opened`);
  return (
    <div className="screen has-nav settings-screen">
      <AppStatusBar />
      <Header title="Settings & Safety" back={() => navigate("profile")}/>
      <main className="screen-content settings-content">
        <h2>Account</h2>
        <div className="menu-card"><MenuRow icon="edit" label="Edit Profile" onClick={() => activate("Edit Profile")}/><MenuRow icon="bell" label="Notification Settings" onClick={() => activate("Notification Settings")}/><MenuRow icon="privacy" label="Privacy" onClick={() => activate("Privacy")} last/></div>
        <h2>Safety</h2>
        <div className="menu-card"><MenuRow icon="blocked" label="Blocked Users" onClick={() => activate("Blocked Users")}/><MenuRow icon="help" label="Help & Support" onClick={() => activate("Help & Support")}/><MenuRow icon="shield" label="Emergency Contact" danger onClick={() => activate("Emergency Contact")} last/></div>
        <button className="logout-button" onClick={() => navigate("onboarding")}>Log Out</button>
      </main>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name="quests" size={31}/></div><h3>{title}</h3><p>{copy}</p></div>;
}

function CreateSheet({ close }: { close: () => void }) {
  const [step, setStep] = useState<"form" | "done">("form");
  return <div className="sheet-backdrop" onMouseDown={close}><section className="create-sheet" onMouseDown={(event: { stopPropagation: () => void }) => event.stopPropagation()} aria-modal="true" role="dialog" aria-label="Create a quest">
    <div className="sheet-handle"/>
    <button className="sheet-close" onClick={close} aria-label="Close"><Icon name="close" size={22}/></button>
    {step === "form" ? <>
      <span className="sheet-icon"><Icon name="plus" size={28}/></span><h2>Create a Quest</h2><p>Start with a simple idea. Your community can help shape the rest.</p>
      <label>What would you like to do?<input defaultValue="Share a friendly activity"/></label>
      <label>Preferred group size<select defaultValue="3–4 people"><option>2 people</option><option>3–4 people</option><option>5–6 people</option></select></label>
      <button className="primary-button" onClick={() => setStep("done")}>Continue</button>
    </> : <div className="sheet-success"><span><Icon name="check" size={34}/></span><h2>Quest draft created</h2><p>You can return later to add the time and location.</p><button className="primary-button" onClick={close}>Done</button></div>}
  </section></div>;
}

export default function Home() {
  const [page, setPage] = useState<Page>("onboarding");
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = (next: Page) => {
    setPage(next);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const screen = useMemo(() => {
    switch (page) {
      case "onboarding": return <Onboarding onStart={() => navigate("home")}/>;
      case "home": return <HomeScreen navigate={navigate}/>;
      case "needs": return <NeedsScreen navigate={navigate}/>;
      case "quests": return <QuestsScreen navigate={navigate}/>;
      case "detail": return <DetailScreen navigate={navigate}/>;
      case "invites": return <InvitesScreen navigate={navigate}/>;
      case "myquests": return <MyQuestsScreen navigate={navigate}/>;
      case "messages": return <MessagesScreen onCreate={() => setCreateOpen(true)}/>;
      case "profile": return <ProfileScreen navigate={navigate}/>;
      case "settings": return <SettingsScreen navigate={navigate}/>;
    }
  }, [page]);

  return (
    <main className="app-stage">
      <div className="phone-shell">
        {screen}
        {page !== "onboarding" ? <BottomNav page={page} navigate={navigate} onCreate={() => setCreateOpen(true)}/> : null}
        {createOpen ? <CreateSheet close={() => setCreateOpen(false)}/> : null}
      </div>
    </main>
  );
}
