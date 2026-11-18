
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowLeft, ArrowRight, BookOpen, Brain, Check, ChevronDown, CircleHelp,
  Clock3, Download, FileText, Flame, FolderOpen, Home, Moon, MoreHorizontal,
  Plus, Search, Settings as SettingsIcon, Sparkles, Sun, Trash2, Upload, X
} from "lucide-react";
import { repo, uid } from "./lib/db";
import {
  scheduleReview, getDueCards, capIntervalForExam, RATING, DAY
} from "./lib/scheduler";
import { extractFile } from "./lib/extract";
import { generateCards } from "./lib/ai";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from "recharts";

const dateKey = d => new Date(d).toISOString().slice(0, 10);
const today = () => dateKey(new Date());

const freshCard = (deckId, type = "qa") => ({
  id: uid(),
  deckId,
  type,
  front: "",
  back: "",
  tags: [],
  ease: 2.5,
  interval: 0,
  reps: 0,
  lapses: 0,
  dueDate: new Date().toISOString(),
  createdAt: new Date().toISOString()
});

const defaultSettings = {
  maxNew: 10,
  maxReviews: 100,
  reminder: false,
  theme: "light"
};

const navItems = [
  { id: "home", label: "Overview", icon: Home },
  { id: "decks", label: "My decks", icon: BookOpen },
  { id: "upload", label: "Upload notes", icon: Upload },
  { id: "stats", label: "Statistics", icon: Activity },
  { id: "settings", label: "Settings", icon: SettingsIcon }
];

function Button({ children, onClick, variant = "primary", className = "", ...props }) {
  return (
    <button
      onClick={onClick}
      className={`btn btn-${variant} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function Field({ label, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}

function Empty({ icon: Icon = BookOpen, title, body, action, actionLabel }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon size={22} /></div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action && <Button onClick={action}>{actionLabel}</Button>}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal" onMouseDown={e => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function clozePrompt(front) {
  return front.replace(/\{\{c\d+::(.*?)\}\}/g, "＿＿＿＿");
}

function normalize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export default function App() {
  const [page, setPage] = useState("home");
  const [decks, setDecks] = useState([]);
  const [cards, setCards] = useState([]);
  const [logs, setLogs] = useState([]);
  const [sources, setSources] = useState([]);
  const [settings, setSettings] = useState(defaultSettings);
  const [activeDeck, setActiveDeck] = useState(null);
  const [toast, setToast] = useState("");
  const [reviewQueue, setReviewQueue] = useState([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [response, setResponse] = useState("");
  const [reviewDone, setReviewDone] = useState(false);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [dark, setDark] = useState(false);

  const [uploadState, setUploadState] = useState({
    status: "idle",
    progress: "",
    sections: [],
    fileName: "",
    fileType: "",
    sourceId: null,
    deckId: ""
  });

  const [proposals, setProposals] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [manual, setManual] = useState({
    type: "qa",
    front: "",
    back: "",
    tags: ""
  });

  const fileRef = useRef(null);
  const [newDeckName, setNewDeckName] = useState("");
  const [editingDeck, setEditingDeck] = useState(null);

  // IMPORTANT: Calculate due cards BEFORE effects that use dueCount.
  const due = useMemo(() => getDueCards(cards), [cards]);
  const dueCount = due.length;

  const notify = message => setToast(message);

  const refresh = async () => {
    const [d, c, l, s, st] = await Promise.all([
      repo.all("decks"),
      repo.all("cards"),
      repo.all("logs"),
      repo.all("sources"),
      repo.get("settings", "app")
    ]);

    setDecks(d);
    setCards(c);
    setLogs(l);
    setSources(s);
    setSettings(st?.value || defaultSettings);
  };

  useEffect(() => {
    refresh().catch(() => notify("Could not open local study database."));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    if (settings.theme === "dark") {
      setDark(true);
    } else if (settings.theme === "light") {
      setDark(false);
    } else if (settings.theme === "system") {
      setDark(
        window.matchMedia?.("(prefers-color-scheme: dark)")?.matches || false
      );
    }
  }, [settings.theme]);

  // Safer notification effect: dueCount is initialized before this effect.
  useEffect(() => {
    if (!settings.reminder) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (dueCount <= 0) return;

    const key = "recall-reminder-last-shown";
    const todayKey = new Date().toISOString().slice(0, 10);

    try {
      if (localStorage.getItem(key) !== todayKey) {
        new Notification("Time for a Recall session", {
          body: `You have ${dueCount} cards ready to review.`
        });
        localStorage.setItem(key, todayKey);
      }
    } catch (error) {
      console.error("Could not display reminder:", error);
    }
  }, [settings.reminder, dueCount]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const todayLogs = logs.filter(l => dateKey(l.timestamp) === today());

  const streak = useMemo(() => {
    const days = new Set(logs.map(l => dateKey(l.timestamp)));
    let count = 0;
    const d = new Date();
    d.setHours(0, 0, 0, 0);

    if (!days.has(dateKey(d))) d.setDate(d.getDate() - 1);

    while (days.has(dateKey(d))) {
      count++;
      d.setDate(d.getDate() - 1);
    }

    return count;
  }, [logs]);

  const retention = useMemo(() => {
    const cutoff = Date.now() - 30 * DAY;
    const recent = logs.filter(
      l => new Date(l.timestamp).getTime() >= cutoff
    );

    return recent.length
      ? Math.round(
          recent.filter(l => l.rating >= 2).length / recent.length * 100
        )
      : 0;
  }, [logs]);

  const maturity = useMemo(() => ({
    fresh: cards.filter(c => !c.reps).length,
    learning: cards.filter(c => c.reps > 0 && c.interval < 21).length,
    mature: cards.filter(c => c.interval >= 21).length
  }), [cards]);

  const forecast = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + i);
        const key = dateKey(d);

        return {
          day: d.toLocaleDateString(undefined, { weekday: "short" }),
          count: cards.filter(c => dateKey(c.dueDate) === key).length
        };
      }),
    [cards]
  );

  async function saveSettings(next) {
    const merged = { ...settings, ...next };
    setSettings(merged);
    await repo.put("settings", { id: "app", value: merged });
  }

  async function createDeck(name) {
    if (!name.trim()) return;

    const deck = {
      id: uid(),
      name: name.trim(),
      createdAt: new Date().toISOString()
    };

    await repo.put("decks", deck);
    await refresh();
    setNewDeckName("");
    setModal(null);
    notify("Deck created.");
  }

  async function renameDeck(deck) {
    if (!editingDeck?.name?.trim()) return;

    await repo.put("decks", {
      ...deck,
      name: editingDeck.name.trim()
    });

    await refresh();
    setEditingDeck(null);
    setModal(null);
  }

  async function deleteDeck(deck) {
    if (!confirm(`Delete “${deck.name}” and all its cards? This cannot be undone.`)) {
      return;
    }

    await Promise.all(
      cards
        .filter(c => c.deckId === deck.id)
        .map(c => repo.remove("cards", c.id))
    );

    await repo.remove("decks", deck.id);
    await refresh();
    setActiveDeck(null);
    setModal(null);
    notify("Deck deleted.");
  }

  async function saveCard(card) {
    await repo.put("cards", card);
    await refresh();
  }

  async function removeCard(card) {
    if (!confirm("Delete this card?")) return;
    await repo.remove("cards", card.id);
    await refresh();
  }

  function startReview(deckId = null) {
    const target = cards.filter(c => !deckId || c.deckId === deckId);
    const dueCards = getDueCards(target);

    const newCards = target
      .filter(c => !c.reps && new Date(c.dueDate) <= new Date())
      .slice(0, settings.maxNew);

    const reviews = dueCards
      .filter(c => c.reps > 0)
      .slice(0, settings.maxReviews);

    const queue = [
      ...reviews,
      ...newCards.filter(c => !reviews.some(r => r.id === c.id))
    ];

    if (!queue.length) {
      notify("Nothing due right now. You're all caught up.");
      return;
    }

    setReviewQueue(queue);
    setReviewIndex(0);
    setRevealed(false);
    setResponse("");
    setReviewDone(false);
    setPage("review");
  }

  async function rateCard(rating) {
    const card = reviewQueue[reviewIndex];
    if (!card) return;

    let updated = scheduleReview(card, rating, new Date());
    const deck = decks.find(d => d.id === card.deckId);

    if (deck?.examDate) {
      const capped = capIntervalForExam(
        updated.interval,
        new Date(),
        deck.examDate
      );

      updated.interval = capped;
      updated.dueDate = new Date(Date.now() + capped * DAY).toISOString();
    }

    await saveCard(updated);

    await repo.put("logs", {
      id: uid(),
      cardId: card.id,
      timestamp: new Date().toISOString(),
      rating,
      intervalBefore: card.interval || 0,
      intervalAfter: updated.interval
    });

    setLogs(await repo.all("logs"));

    if (reviewIndex + 1 >= reviewQueue.length) {
      setReviewDone(true);
    } else {
      setReviewIndex(i => i + 1);
      setRevealed(false);
      setResponse("");
    }
  }

  useEffect(() => {
    const handler = e => {
      if (page !== "review") return;

      if (e.code === "Space" && !revealed && !e.repeat) {
        e.preventDefault();
        setRevealed(true);
      }

      if (
        revealed &&
        ["Digit1", "Digit2", "Digit3", "Digit4"].includes(e.code)
      ) {
        e.preventDefault();
        rateCard(Number(e.code.slice(-1)) - 1);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [page, revealed, reviewIndex, reviewQueue]);

  async function saveManual() {
    if (!activeDeck || !manual.front.trim() || !manual.back.trim()) return;

    const card = {
      ...freshCard(activeDeck.id, manual.type),
      front: manual.front.trim(),
      back: manual.back.trim(),
      tags: manual.tags.split(",").map(x => x.trim()).filter(Boolean)
    };

    await saveCard(card);
    setManual({ type: "qa", front: "", back: "", tags: "" });
    setModal(null);
    notify("Card saved.");
  }

  async function bulkImport() {
    if (!activeDeck) {
      notify("Open a deck before importing cards.");
      return;
    }

    const lines = bulkText
      .split(/\r?\n/)
      .map(x => x.trim())
      .filter(Boolean);

    let added = 0;

    for (const line of lines) {
      const parts = line.split("|");
      if (parts.length < 2) continue;

      await repo.put("cards", {
        ...freshCard(activeDeck.id),
        front: parts[0].trim(),
        back: parts.slice(1).join("|").trim()
      });

      added++;
    }

    await refresh();
    setBulkText("");
    setModal(null);
    notify(`${added} card${added === 1 ? "" : "s"} imported.`);
  }

  async function onFile(file) {
    if (!file) return;

    setUploadState({
      status: "extracting",
      progress: "Preparing file…",
      sections: [],
      fileName: file.name,
      fileType: file.name.split(".").pop().toLowerCase(),
      sourceId: null,
      deckId: decks[0]?.id || ""
    });

    try {
      const sections = await extractFile(
        file,
        p => setUploadState(s => ({ ...s, progress: p }))
      );

      const sourceId = uid();

      setUploadState(s => ({
        ...s,
        status: "preview",
        sections: sections.map((x, i) => ({
          ...x,
          id: `${sourceId}-${i}`,
          selected: true
        })),
        sourceId,
        progress: `${sections.length} sections extracted`
      }));
    } catch (e) {
      setUploadState(s => ({
        ...s,
        status: "error",
        progress: e.message || "Could not extract this file."
      }));
    }
  }

  async function generate() {
    const selected = uploadState.sections.filter(
      s => s.selected && s.text.trim()
    );

    if (!selected.length || !uploadState.deckId) {
      notify("Select at least one section and a destination deck.");
      return;
    }

    setGenerating(true);
    setUploadState(s => ({
      ...s,
      status: "generating",
      progress: "Preparing notes…"
    }));

    try {
      const generated = await generateCards(
        selected,
        decks.find(d => d.id === uploadState.deckId)?.name,
        p => setUploadState(s => ({ ...s, progress: p }))
      );

      const source = {
        id: uploadState.sourceId,
        fileName: uploadState.fileName,
        fileType: uploadState.fileType,
        uploadedAt: new Date().toISOString(),
        sections: selected.map(({ id, title, text }) => ({
          id,
          title,
          text
        }))
      };

      await repo.put("sources", source);
      setSources(await repo.all("sources"));

      setProposals(
        generated.map((c, i) => ({
          ...c,
          id: `proposal-${i}-${uid()}`,
          sourceId: source.id,
          deckId: uploadState.deckId,
          duplicate: cards.some(
            old =>
              old.deckId === uploadState.deckId &&
              (
                normalize(old.front) === normalize(c.front) ||
                normalize(old.back) === normalize(c.back)
              )
          )
        }))
      );

      setUploadState(s => ({
        ...s,
        status: "approval",
        progress: `${generated.length} proposed cards`
      }));
    } catch (e) {
      setUploadState(s => ({
        ...s,
        status: "error",
        progress: e.message || "Card generation failed."
      }));
    } finally {
      setGenerating(false);
    }
  }

  async function approveProposal(p) {
    const card = {
      ...freshCard(p.deckId, p.type),
      front: p.front,
      back: p.back,
      sourceId: p.sourceId,
      sourceSection: p.sourceSection
    };

    await repo.put("cards", card);
    setProposals(old => old.filter(x => x.id !== p.id));
    await refresh();
  }

  async function approveAll() {
    const approved = proposals.map(p => ({
      ...freshCard(p.deckId, p.type),
      front: p.front,
      back: p.back,
      sourceId: p.sourceId,
      sourceSection: p.sourceSection
    }));

    await repo.bulkPut("cards", approved);
    setProposals([]);
    await refresh();
    notify(`${approved.length} cards added to your deck.`);
  }

  function updateProposal(id, patch) {
    setProposals(old =>
      old.map(p => p.id === id ? { ...p, ...patch } : p)
    );
  }

  async function exportData() {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      decks,
      cards,
      logs,
      sources,
      settings
    };

    const blob = new Blob(
      [JSON.stringify(data, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recall-backup-${today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importData(file) {
    try {
      const data = JSON.parse(await file.text());

      if (!Array.isArray(data.decks) || !Array.isArray(data.cards)) {
        throw new Error("This file does not look like a Recall backup.");
      }

      await repo.bulkPut("decks", data.decks);
      await repo.bulkPut("cards", data.cards);

      if (data.logs) await repo.bulkPut("logs", data.logs);
      if (data.sources) await repo.bulkPut("sources", data.sources);
      if (data.settings) await saveSettings(data.settings);

      await refresh();
      notify("Backup imported.");
    } catch (e) {
      notify(e.message);
    }
  }

  async function toggleReminder(value) {
    if (
      value &&
      (typeof window === "undefined" || !("Notification" in window))
    ) {
      notify("Browser notifications are not supported here.");
      return;
    }

    if (value) {
      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        notify("Notification permission was not granted.");
        return;
      }
    }

    await saveSettings({ reminder: value });
    notify(
      value
        ? "Daily reminder enabled in this browser."
        : "Reminder disabled."
    );
  }

  const activeDeckCards = cards.filter(
    c => c.deckId === activeDeck?.id
  );

  const current = reviewQueue[reviewIndex];
  const currentDeck = decks.find(d => d.id === current?.deckId);

  const nav = id => {
    setPage(id);
    setActiveDeck(null);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => nav("home")}>
          <span className="brand-mark"><Brain size={20} /></span>
          <span>recall<span className="brand-dot">.</span></span>
        </button>

        <div className="side-label">STUDY SPACE</div>

        <nav>
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => nav(item.id)}
              className={`nav-link ${
                page === item.id ||
                (page === "detail" && item.id === "decks")
                  ? "active"
                  : ""
              }`}
            >
              <item.icon size={18} />
              {item.label}
              {item.id === "home" && dueCount > 0 && (
                <span className="nav-count">{dueCount}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="streak-card">
            <div className="streak-icon"><Flame size={17} /></div>
            <div>
              <strong>{streak} day streak</strong>
              <span>Keep showing up.</span>
            </div>
          </div>
          <div className="sidebar-foot">A little, often, adds up.</div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark"><Brain size={18} /></span>
            {" "}recall<span className="brand-dot">.</span>
          </div>

          <div className="topbar-right">
            <span className="today-label">
              {new Date().toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric"
              })}
            </span>

            <button
              className="icon-btn"
              onClick={() => setDark(v => !v)}
              aria-label="Toggle theme"
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <button
              className="avatar"
              onClick={() => setPage("settings")}
            >
              R
            </button>
          </div>
        </header>

        <div className="content">
          {page === "home" && (
            <HomePage
              dueCount={dueCount}
              streak={streak}
              todayCount={todayLogs.length}
              decks={decks}
              cards={cards}
              startReview={() => startReview()}
              goDecks={() => setPage("decks")}
              create={() => setModal({ type: "createDeck" })}
            />
          )}

          {page === "decks" && (
            <DecksPage
              decks={decks}
              cards={cards}
              logs={logs}
              open={d => {
                setActiveDeck(d);
                setPage("detail");
              }}
              create={() => setModal({ type: "createDeck" })}
            />
          )}

          {page === "detail" && activeDeck && (
            <DeckDetail
              deck={activeDeck}
              cards={activeDeckCards}
              sources={sources}
              search={search}
              setSearch={setSearch}
              add={() => setModal({ type: "addCard" })}
              bulk={() => setModal({ type: "bulk" })}
              review={() => startReview(activeDeck.id)}
              edit={c => setModal({ type: "editCard", card: c })}
              remove={removeCard}
              rename={() => {
                setEditingDeck({ name: activeDeck.name });
                setModal({ type: "renameDeck" });
              }}
              deleteDeck={() => setModal({ type: "deleteDeck" })}
              examDate={activeDeck.examDate || ""}
              onBack={() => setPage("decks")}
              setExamDate={async value => {
                const updated = {
                  ...activeDeck,
                  examDate: value || undefined
                };

                await repo.put("decks", updated);
                setActiveDeck(updated);
                await refresh();
              }}
            />
          )}

          {page === "upload" && (
            <UploadPage
              decks={decks}
              state={uploadState}
              setState={setUploadState}
              fileRef={fileRef}
              onFile={onFile}
              generate={generate}
              generating={generating}
              proposals={proposals}
              updateProposal={updateProposal}
              approve={approveProposal}
              approveAll={approveAll}
              discard={id =>
                setProposals(p => p.filter(x => x.id !== id))
              }
              retry={() =>
                setUploadState(s => ({ ...s, status: "idle", progress: "" }))
              }
              reset={() => {
                setUploadState({
                  status: "idle",
                  progress: "",
                  sections: [],
                  fileName: "",
                  fileType: "",
                  sourceId: null,
                  deckId: decks[0]?.id || ""
                });
                setProposals([]);
              }}
              cards={cards}
            />
          )}

          {page === "stats" && (
            <StatsPage
              cards={cards}
              logs={logs}
              retention={retention}
              maturity={maturity}
              forecast={forecast}
              streak={streak}
            />
          )}

          {page === "settings" && (
            <SettingsPage
              settings={settings}
              save={saveSettings}
              toggleReminder={toggleReminder}
              exportData={exportData}
              importData={importData}
            />
          )}

          {page === "review" && (
            <ReviewPage
              current={current}
              currentDeck={currentDeck}
              index={reviewIndex}
              total={reviewQueue.length}
              revealed={revealed}
              setRevealed={setRevealed}
              response={response}
              setResponse={setResponse}
              rate={rateCard}
              done={reviewDone}
              back={() => setPage("home")}
              again={() => startReview(currentDeck?.id)}
            />
          )}
        </div>
      </main>

      <nav className="mobile-nav">
        {navItems
          .filter(x => ["home", "decks", "upload", "stats"].includes(x.id))
          .map(item => (
            <button
              key={item.id}
              onClick={() => nav(item.id)}
              className={page === item.id ? "active" : ""}
            >
              <item.icon size={19} />
              <span>
                {item.label === "Overview"
                  ? "Home"
                  : item.label === "My decks"
                    ? "Decks"
                    : item.label === "Statistics"
                      ? "Stats"
                      : "Upload"}
              </span>
            </button>
          ))}
      </nav>

      {modal && (
        <Modal
          title={
            modal.type === "createDeck"
              ? "Create a deck"
              : modal.type === "renameDeck"
                ? "Rename deck"
                : modal.type === "deleteDeck"
                  ? "Delete deck"
                  : modal.type === "bulk"
                    ? "Bulk import cards"
                    : modal.type === "editCard"
                      ? "Edit card"
                      : "Add a card"
          }
          onClose={() => setModal(null)}
        >
          {modal.type === "createDeck" && (
            <div className="modal-body">
              <Field
                label="Deck name"
                value={newDeckName}
                onChange={e => setNewDeckName(e.target.value)}
                placeholder="e.g. Equity & Trusts"
                autoFocus
              />
              <Button
                onClick={() => createDeck(newDeckName)}
                className="full"
              >
                Create deck
              </Button>
            </div>
          )}

          {modal.type === "renameDeck" && (
            <div className="modal-body">
              <Field
                label="Deck name"
                value={editingDeck?.name || ""}
                onChange={e => setEditingDeck({ name: e.target.value })}
              />
              <Button
                onClick={() => renameDeck(activeDeck)}
                className="full"
              >
                Save changes
              </Button>
            </div>
          )}

          {modal.type === "deleteDeck" && (
            <div className="modal-body">
              <p>
                This permanently deletes <strong>{activeDeck?.name}</strong>
                {" "}and its cards from this browser.
              </p>
              <Button
                variant="danger"
                onClick={() => deleteDeck(activeDeck)}
                className="full"
              >
                Delete deck and cards
              </Button>
            </div>
          )}

          {(modal.type === "addCard" || modal.type === "editCard") && (
            <div className="modal-body">
              <label className="field">
                <span>Card type</span>
                <select
                  value={modal.card?.type || manual.type}
                  onChange={e =>
                    modal.card
                      ? setModal({
                          ...modal,
                          card: { ...modal.card, type: e.target.value }
                        })
                      : setManual({ ...manual, type: e.target.value })
                  }
                >
                  <option value="qa">Question & answer</option>
                  <option value="cloze">Cloze deletion</option>
                  <option value="blurt">Free recall / blurt</option>
                </select>
              </label>

              <label className="field">
                <span>
                  {manual.type === "blurt" ? "Prompt" : "Front"}
                </span>
                <textarea
                  rows="3"
                  value={modal.card?.front ?? manual.front}
                  onChange={e =>
                    modal.card
                      ? setModal({
                          ...modal,
                          card: { ...modal.card, front: e.target.value }
                        })
                      : setManual({ ...manual, front: e.target.value })
                  }
                  placeholder="Write a clear recall prompt…"
                />
              </label>

              <label className="field">
                <span>
                  {manual.type === "blurt" ? "Reference notes" : "Answer"}
                </span>
                <textarea
                  rows="4"
                  value={modal.card?.back ?? manual.back}
                  onChange={e =>
                    modal.card
                      ? setModal({
                          ...modal,
                          card: { ...modal.card, back: e.target.value }
                        })
                      : setManual({ ...manual, back: e.target.value })
                  }
                  placeholder="The answer or reference notes…"
                />
              </label>

              <Field
                label="Tags (comma separated)"
                value={
                  modal.card?.tags?.join(", ") ?? manual.tags
                }
                onChange={e =>
                  modal.card
                    ? setModal({
                        ...modal,
                        card: {
                          ...modal.card,
                          tags: e.target.value
                            .split(",")
                            .map(x => x.trim())
                        }
                      })
                    : setManual({ ...manual, tags: e.target.value })
                }
                placeholder="cases, definitions"
              />

              <Button
                className="full"
                onClick={async () => {
                  if (modal.card) {
                    await saveCard({
                      ...modal.card,
                      tags: Array.isArray(modal.card.tags)
                        ? modal.card.tags
                        : []
                    });
                    setModal(null);
                  } else {
                    saveManual();
                  }
                }}
              >
                Save card
              </Button>
            </div>
          )}

          {modal.type === "bulk" && (
            <div className="modal-body">
              <p className="muted">
                One card per line. Separate the prompt and answer with a
                vertical bar.
              </p>
              <textarea
                rows="8"
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
                placeholder={
                  "What is equity? | A body of rules developed by the Court of Chancery.\nWhat is a trust? | An equitable obligation…"
                }
              />
              <Button className="full" onClick={bulkImport}>
                Import cards
              </Button>
            </div>
          )}
        </Modal>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function HomePage({
  dueCount, streak, todayCount, decks, cards, startReview, goDecks, create
}) {
  const recent = decks.slice(0, 3);

  return (
    <div className="page-wrap">
      <div className="eyebrow">YOUR STUDY SPACE</div>

      <div className="page-heading">
        <div>
          <h1>Make it <em>stick.</em></h1>
          <p className="subtitle">
            A little progress, repeated, becomes mastery.
          </p>
        </div>
        <div className="greeting-mark"><Sparkles size={22} /></div>
      </div>

      <section className="hero-panel">
        <div className="hero-copy">
          <span className="hero-kicker">
            <span className="live-dot" /> YOUR DAILY SESSION
          </span>

          <h2>
            {dueCount
              ? `${dueCount} cards are ready.`
              : "You're all caught up."}
          </h2>

          <p>
            {dueCount
              ? "Bring what you've learned back to the surface."
              : "Enjoy the breathing room. Add cards or revisit a deck when you're ready."}
          </p>

          <Button onClick={startReview} disabled={!dueCount}>
            {dueCount ? "Start reviewing" : "Nothing due today"}
            {" "}<ArrowRight size={16} />
          </Button>
        </div>

        <div className="hero-art">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit-core"><Brain size={42} /></div>
          <span className="orbit-star star-one">✳</span>
          <span className="orbit-star star-two">✦</span>
        </div>
      </section>

      <div className="stat-grid">
        <Stat
          label="Current streak"
          value={`${streak} days`}
          icon={Flame}
          note="Consistency is everything"
        />
        <Stat
          label="Reviews today"
          value={todayCount}
          icon={Check}
          note="Cards you've revisited"
        />
        <Stat
          label="Total cards"
          value={cards.length}
          icon={BookOpen}
          note="Across all your decks"
        />
      </div>

      <div className="section-head">
        <div>
          <h2>Your study space</h2>
          <p className="muted">Pick up where you left off.</p>
        </div>
        <button className="text-action" onClick={goDecks}>
          All decks <ArrowRight size={15} />
        </button>
      </div>

      {recent.length ? (
        <div className="deck-grid">
          {recent.map(d => (
            <DeckTile key={d.id} deck={d} cards={cards} />
          ))}
        </div>
      ) : (
        <Empty
          icon={FolderOpen}
          title="Your first deck starts here"
          body="Create a deck for a subject, course or topic. Then add cards manually or from your notes."
          action={create}
          actionLabel="Create your first deck"
        />
      )}
    </div>
  );
}

function Stat({ label, value, icon: Icon, note }) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <Icon size={17} />
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function DeckTile({ deck, cards }) {
  const count = cards.filter(c => c.deckId === deck.id).length;
  const due = cards.filter(
    c => c.deckId === deck.id && new Date(c.dueDate) <= new Date()
  ).length;

  return (
    <div className="deck-tile">
      <div className="tile-top">
        <span className="deck-glyph"><BookOpen size={18} /></span>
        <MoreHorizontal size={18} />
      </div>
      <h3>{deck.name}</h3>
      <p>{count} cards · {due} due</p>
      <div className="tile-progress">
        <span
          style={{
            width: `${
              count
                ? Math.max(
                    8,
                    Math.round(
                      cards.filter(
                        c => c.deckId === deck.id && c.reps > 0
                      ).length / count * 100
                    )
                  )
                : 0
            }%`
          }}
        />
      </div>
    </div>
  );
}

function DecksPage({ decks, cards, logs, open, create }) {
  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR LIBRARY</div>
          <h1>My decks</h1>
          <p className="subtitle">
            Everything you're learning, in one place.
          </p>
        </div>
        <Button onClick={create}>
          <Plus size={17} /> New deck
        </Button>
      </div>

      {decks.length ? (
        <div className="deck-list">
          {decks.map(d => {
            const list = cards.filter(c => c.deckId === d.id);
            const due = list.filter(
              c => new Date(c.dueDate) <= new Date()
            ).length;

            return (
              <button
                className="deck-row"
                key={d.id}
                onClick={() => open(d)}
              >
                <span className="deck-glyph large">
                  <BookOpen size={20} />
                </span>
                <span className="deck-row-main">
                  <strong>{d.name}</strong>
                  <small>
                    {list.length} cards · {list.filter(c => c.reps > 0).length} studied
                  </small>
                </span>
                <span className="deck-due">{due} due</span>
                <ArrowRight size={17} />
              </button>
            );
          })}
        </div>
      ) : (
        <Empty
          icon={FolderOpen}
          title="No decks yet"
          body="Create your first deck to organise your study cards."
          action={create}
          actionLabel="Create a deck"
        />
      )}
    </div>
  );
}

function DeckDetail({
  deck, cards, sources, search, setSearch, add, bulk, review,
  edit, remove, rename, deleteDeck, examDate, setExamDate, onBack
}) {
  const filtered = cards.filter(c =>
    `${c.front} ${c.back} ${(c.tags || []).join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  return (
    <div className="page-wrap">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={15} /> Your decks
      </button>

      <div className="page-heading detail-heading">
        <div>
          <div className="eyebrow">STUDY DECK</div>
          <h1>{deck.name}</h1>
          <p className="subtitle">
            {cards.length} cards · {cards.filter(c => c.reps > 0).length} reviewed
          </p>
        </div>

        <div className="heading-actions">
          <Button variant="secondary" onClick={rename}>Rename</Button>
          <Button onClick={review}>
            Review deck <ArrowRight size={16} />
          </Button>
        </div>
      </div>

      <div className="exam-strip">
        <div>
          <strong>Exam date</strong>
          <small>
            Intervals will be capped so every card comes up before your exam.
          </small>
        </div>
        <input
          type="date"
          value={examDate}
          onChange={e => setExamDate(e.target.value)}
        />
      </div>

      <div className="section-head">
        <div>
          <h2>Cards</h2>
          <p className="muted">Search, edit or add to this deck.</p>
        </div>
        <div className="inline-actions">
          <Button variant="secondary" onClick={bulk}>Bulk import</Button>
          <Button onClick={add}><Plus size={16} /> Add card</Button>
        </div>
      </div>

      <div className="search-box">
        <Search size={17} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search cards and tags…"
        />
      </div>

      {filtered.length ? (
        <div className="card-list">
          {filtered.map(c => (
            <div className="card-row" key={c.id}>
              <div className="card-type">
                {c.type === "cloze"
                  ? "CLOZE"
                  : c.type === "blurt"
                    ? "BLURT"
                    : "Q&A"}
              </div>

              <div className="card-row-content">
                <strong>
                  {c.front.replace(/\{\{c\d+::(.*?)\}\}/g, "[$1]")}
                </strong>
                <p>{c.back}</p>

                <div className="tag-row">
                  {(c.tags || []).map(t => (
                    <span className="tag" key={t}>{t}</span>
                  ))}
                  {c.sourceId && (
                    <span className="source-label">
                      Source · {sources.find(s => s.id === c.sourceId)?.fileName || "Uploaded notes"}
                    </span>
                  )}
                </div>
              </div>

              <div className="row-actions">
                <button
                  className="icon-btn"
                  onClick={() => edit(c)}
                  aria-label="Edit card"
                >
                  ✎
                </button>
                <button
                  className="icon-btn danger-text"
                  onClick={() => remove(c)}
                  aria-label="Delete card"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          icon={CircleHelp}
          title={
            cards.length
              ? "No matching cards"
              : "This deck is waiting for its first card"
          }
          body={
            cards.length
              ? "Try a different search term."
              : "Add a question manually, paste a batch, or upload your notes to generate cards."
          }
          action={add}
          actionLabel="Add your first card"
        />
      )}

      <button className="danger-link" onClick={deleteDeck}>
        Delete this deck
      </button>
    </div>
  );
}

function ReviewPage({
  current, currentDeck, index, total, revealed, setRevealed,
  response, setResponse, rate, done, back, again
}) {
  if (done) {
    return (
      <div className="review-finish">
        <div className="finish-icon"><Check size={28} /></div>
        <div className="eyebrow">SESSION COMPLETE</div>
        <h1>That's a wrap.</h1>
        <p className="subtitle">
          You brought {total} cards back to mind. That's how memory gets stronger.
        </p>
        <div className="finish-actions">
          <Button onClick={back}>Back to overview</Button>
          <Button variant="secondary" onClick={again}>
            Review this deck again
          </Button>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <Empty
        title="Nothing to review"
        body="Your queue is clear."
        action={back}
        actionLabel="Back home"
      />
    );
  }

  return (
    <div className="review-shell">
      <div className="review-top">
        <button className="back-link" onClick={back}>
          <X size={16} /> End session
        </button>
        <span className="review-counter">
          {index + 1} <span>/</span> {total}
        </span>
      </div>

      <div className="progress-track">
        <span style={{ width: `${(index / total) * 100}%` }} />
      </div>

      <div className="review-context">
        <span>{currentDeck?.name || "Study session"}</span>
        <span className="dot-sep">·</span>
        <span>
          {current.type === "cloze"
            ? "CLOZE"
            : current.type === "blurt"
              ? "FREE RECALL"
              : "QUESTION"}
        </span>
      </div>

      <div className={`flashcard ${revealed ? "revealed" : ""}`}>
        <div className="flashcard-inner">
          <div className="flash-front">
            <span className="card-overline">RECALL FROM MEMORY</span>
            <h2>
              {current.type === "cloze"
                ? clozePrompt(current.front)
                : current.front}
            </h2>
            {current.type === "blurt" && (
              <p className="muted">
                Write everything you can remember. Don't worry about being perfect.
              </p>
            )}
          </div>

          <div className="flash-back">
            <span className="card-overline">REFERENCE ANSWER</span>
            <p>{current.back}</p>
          </div>
        </div>
      </div>

      {!revealed ? (
        <div className="answer-area">
          <label className="field">
            <span>
              Your attempt{" "}
              <small>(optional — you can also answer in your head)</small>
            </span>
            <textarea
              rows="3"
              value={response}
              onChange={e => setResponse(e.target.value)}
              placeholder="Type what you remember before revealing…"
            />
          </label>

          <Button
            className="reveal-button"
            onClick={() => setRevealed(true)}
          >
            Show answer <ArrowRight size={17} />
          </Button>

          <p className="shortcut-hint">
            Press <kbd>Space</kbd> to reveal
          </p>
        </div>
      ) : (
        <div className="rating-area">
          <p>How well did you recall it?</p>
          <div className="rating-grid">
            <button className="rating again" onClick={() => rate(RATING.AGAIN)}>
              <strong>1 · Again</strong>
              <small>Didn't get it</small>
            </button>
            <button className="rating hard" onClick={() => rate(RATING.HARD)}>
              <strong>2 · Hard</strong>
              <small>Struggled</small>
            </button>
            <button className="rating good" onClick={() => rate(RATING.GOOD)}>
              <strong>3 · Good</strong>
              <small>Got it</small>
            </button>
            <button className="rating easy" onClick={() => rate(RATING.EASY)}>
              <strong>4 · Easy</strong>
              <small>Effortless</small>
            </button>
          </div>
          <p className="shortcut-hint">
            Use keys <kbd>1</kbd>–<kbd>4</kbd> to rate
          </p>
        </div>
      )}
    </div>
  );
}

function UploadPage({
  decks, state, setState, fileRef, onFile, generate, generating,
  proposals, updateProposal, approve, approveAll, discard, reset, cards
}) {
  const [drag, setDrag] = useState(false);
  const selected = state.sections.filter(s => s.selected).length;

  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <div className="eyebrow">FROM NOTES TO KNOWLEDGE</div>
          <h1>Upload notes</h1>
          <p className="subtitle">
            Turn your course materials into cards worth remembering.
          </p>
        </div>
        <span className="ai-pill"><Sparkles size={14} /> AI assisted</span>
      </div>

      <div className="privacy-note">
        <span className="privacy-icon"><Sparkles size={17} /></span>
        <p>
          <strong>Your notes, your control.</strong> Extracted text is sent to
          an AI service to generate cards. Original files are not stored.
          Nothing enters a deck until you approve it.
        </p>
      </div>

      {state.status === "idle" && (
        <div
          className={`dropzone ${drag ? "dragging" : ""}`}
          onDragOver={e => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => {
            e.preventDefault();
            setDrag(false);
            onFile(e.dataTransfer.files?.[0]);
          }}
        >
          <div className="upload-icon"><Upload size={24} /></div>
          <h2>Bring your notes in</h2>
          <p>Drag and drop a file here, or browse your device.</p>
          <Button onClick={() => fileRef.current?.click()}>
            <FolderOpen size={17} /> Choose a file
          </Button>

          <input
            ref={fileRef}
            hidden
            type="file"
            accept=".docx,.pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            onChange={e => onFile(e.target.files?.[0])}
          />

          <div className="file-types">
            <span>DOCX</span>
            <span>PDF</span>
            <span>PPTX</span>
            <span>MAX 25 MB</span>
          </div>
          <p className="tiny-muted">
            Legacy .doc and .ppt files aren't supported. Re-save them in a newer format.
          </p>
        </div>
      )}

      {(state.status === "extracting" || state.status === "generating") && (
        <div className="processing-panel">
          <div className="spinner" />
          <h2>
            {state.status === "extracting"
              ? "Reading your notes"
              : "Creating your cards"}
          </h2>
          <p>{state.progress}</p>
          <div className="processing-track"><span /></div>
        </div>
      )}

      {state.status === "error" && (
        <div className="error-panel">
          <h2>We couldn't complete that step.</h2>
          <p>{state.progress}</p>
          <Button onClick={() => setState(s => ({ ...s, status: "idle" }))}>
            Try another file
          </Button>
        </div>
      )}

      {state.status === "preview" && (
        <div className="preview-panel">
          <div className="section-head">
            <div>
              <h2>Review extracted notes</h2>
              <p className="muted">
                {state.fileName} · {state.sections.length} sections found
              </p>
            </div>
            <button className="text-action" onClick={reset}>
              Start over <X size={14} />
            </button>
          </div>

          <label className="field">
            <span>Destination deck</span>
            <select
              value={state.deckId}
              onChange={e =>
                setState(s => ({ ...s, deckId: e.target.value }))
              }
            >
              <option value="">Choose a deck…</option>
              {decks.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>

          {state.sections.map(s => (
            <div className="extract-section" key={s.id}>
              <label className="section-select">
                <input
                  type="checkbox"
                  checked={s.selected}
                  onChange={e =>
                    setState(old => ({
                      ...old,
                      sections: old.sections.map(x =>
                        x.id === s.id
                          ? { ...x, selected: e.target.checked }
                          : x
                      )
                    }))
                  }
                />
                <strong>{s.title}</strong>
              </label>

              <textarea
                value={s.text}
                onChange={e =>
                  setState(old => ({
                    ...old,
                    sections: old.sections.map(x =>
                      x.id === s.id
                        ? { ...x, text: e.target.value }
                        : x
                    )
                  }))
                }
                rows={Math.min(
                  8,
                  Math.max(3, Math.ceil(s.text.length / 110))
                )}
              />
            </div>
          ))}

          <div className="preview-footer">
            <span>
              {selected} of {state.sections.length} sections selected
            </span>
            <Button
              onClick={generate}
              disabled={!selected || !state.deckId || generating}
            >
              <Sparkles size={16} /> Generate cards
            </Button>
          </div>
        </div>
      )}

      {state.status === "approval" && (
        <div className="proposal-panel">
          <div className="section-head">
            <div>
              <h2>Review proposed cards</h2>
              <p className="muted">
                {proposals.length} cards · edit or remove anything before saving.
              </p>
            </div>
            <button className="text-action" onClick={reset}>
              Discard batch
            </button>
          </div>

          {proposals.length ? (
            <>
              <div className="proposal-list">
                {proposals.map(p => (
                  <div className="proposal" key={p.id}>
                    <div className="proposal-head">
                      <span className="card-type">{p.type.toUpperCase()}</span>
                      {p.duplicate && (
                        <span className="duplicate-warning">
                          Possible duplicate
                        </span>
                      )}
                      <button
                        className="icon-btn danger-text"
                        onClick={() => discard(p.id)}
                        aria-label="Delete proposal"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    <label className="field">
                      <span>Front</span>
                      <textarea
                        rows="2"
                        value={p.front}
                        onChange={e =>
                          updateProposal(p.id, { front: e.target.value })
                        }
                      />
                    </label>

                    <label className="field">
                      <span>Back</span>
                      <textarea
                        rows="2"
                        value={p.back}
                        onChange={e =>
                          updateProposal(p.id, { back: e.target.value })
                        }
                      />
                    </label>

                    <span className="source-label">
                      Source · {p.sourceSection}
                    </span>

                    <div className="proposal-actions">
                      <Button
                        variant="secondary"
                        onClick={() => discard(p.id)}
                      >
                        Remove
                      </Button>
                      <Button onClick={() => approve(p)}>
                        <Check size={15} /> Approve card
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <Button className="full approve-all" onClick={approveAll}>
                Approve all {proposals.length} cards
              </Button>
            </>
          ) : (
            <Empty
              icon={Check}
              title="All proposals reviewed"
              body="Your approved cards are now in the destination deck."
              action={reset}
              actionLabel="Upload another file"
            />
          )}
        </div>
      )}

      <div className="supported-row">
        <div>
          <FileText size={18} />
          <span><strong>DOCX</strong><small>Headings and lists</small></span>
        </div>
        <div>
          <FileText size={18} />
          <span><strong>PDF</strong><small>Page-by-page text</small></span>
        </div>
        <div>
          <FileText size={18} />
          <span><strong>PPTX</strong><small>Slides and notes</small></span>
        </div>
      </div>
    </div>
  );
}

function StatsPage({
  cards, logs, retention, maturity, forecast, streak
}) {
  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR PROGRESS</div>
          <h1>Statistics</h1>
          <p className="subtitle">Small steps, made visible.</p>
        </div>
      </div>

      <div className="stat-grid">
        <Stat
          label="Retention · 30 days"
          value={`${retention}%`}
          icon={Activity}
          note="Good and easy ratings"
        />
        <Stat
          label="Reviews completed"
          value={logs.length}
          icon={Check}
          note="All-time review history"
        />
        <Stat
          label="Current streak"
          value={`${streak} days`}
          icon={Flame}
          note="Consecutive study days"
        />
      </div>

      <section className="chart-panel">
        <div className="section-head">
          <div>
            <h2>Upcoming reviews</h2>
            <p className="muted">
              Cards currently scheduled over the next 14 days.
            </p>
          </div>
          <span className="chart-legend"><i /> Due cards</span>
        </div>

        <div className="chart-area">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={forecast}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis
                dataKey="day"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--muted)", fontSize: 11 }}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--muted)", fontSize: 11 }}
              />
              <Tooltip
                cursor={{ fill: "var(--soft)" }}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid var(--line)",
                  background: "var(--surface)"
                }}
              />
              <Bar
                dataKey="count"
                name="Reviews"
                fill="#668b7d"
                radius={[5, 5, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="maturity-panel">
        <div className="section-head">
          <div>
            <h2>Card maturity</h2>
            <p className="muted">
              Where your cards are in the learning process.
            </p>
          </div>
        </div>

        <div className="maturity-bars">
          {[
            ["New", maturity.fresh, "#b9c8c1"],
            ["Learning", maturity.learning, "#829f92"],
            ["Mature", maturity.mature, "#52796f"]
          ].map(([name, value, color]) => (
            <div className="maturity-row" key={name}>
              <div>
                <span>{name}</span>
                <strong>{value}</strong>
              </div>
              <div className="maturity-track">
                <i
                  style={{
                    width: `${cards.length ? value / cards.length * 100 : 0}%`,
                    background: color
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SettingsPage({
  settings, save, toggleReminder, exportData, importData
}) {
  const input = useRef(null);

  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE RECALL YOURS</div>
          <h1>Settings</h1>
          <p className="subtitle">
            Tune your study rhythm and manage your data.
          </p>
        </div>
      </div>

      <section className="settings-section">
        <div className="settings-heading">
          <h2>Daily limits</h2>
          <p>Keep your workload realistic and sustainable.</p>
        </div>

        <div className="setting-row">
          <div>
            <strong>New cards per day</strong>
            <small>How many unseen cards enter your queue.</small>
          </div>
          <input
            type="number"
            min="0"
            max="200"
            value={settings.maxNew}
            onChange={e =>
              save({ maxNew: Math.max(0, Number(e.target.value)) })
            }
          />
        </div>

        <div className="setting-row">
          <div>
            <strong>Reviews per day</strong>
            <small>Maximum scheduled reviews in one day.</small>
          </div>
          <input
            type="number"
            min="1"
            max="1000"
            value={settings.maxReviews}
            onChange={e =>
              save({ maxReviews: Math.max(1, Number(e.target.value)) })
            }
          />
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-heading">
          <h2>Appearance & reminders</h2>
          <p>Make your study space feel comfortable.</p>
        </div>

        <div className="setting-row">
          <div>
            <strong>Daily reminder</strong>
            <small>
              Allow this browser to send study notifications. You can change
              this in browser settings.
            </small>
          </div>
          <input
            type="checkbox"
            checked={!!settings.reminder}
            onChange={e => toggleReminder(e.target.checked)}
          />
        </div>

        <div className="setting-row">
          <div>
            <strong>Theme</strong>
            <small>Choose your preferred appearance.</small>
          </div>
          <select
            value={settings.theme || "light"}
            onChange={e => save({ theme: e.target.value })}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-heading">
          <h2>Your data</h2>
          <p>Your decks and cards are stored locally in this browser.</p>
        </div>

        <div className="data-actions">
          <Button variant="secondary" onClick={exportData}>
            <Download size={16} /> Export JSON backup
          </Button>
          <Button
            variant="secondary"
            onClick={() => input.current?.click()}
          >
            <Upload size={16} /> Import backup
          </Button>
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={e =>
              e.target.files?.[0] && importData(e.target.files[0])
            }
          />
        </div>

        <p className="tiny-muted">
          Import merges records by ID. Export regularly if you may clear
          browser data or change devices.
        </p>
      </section>

      <div className="about-note">
        <Brain size={20} />
        <div>
          <strong>Recall · version 1.0</strong>
          <p>
            Built for active recall, not passive rereading. Your study data
            stays on this device in v1.
          </p>
        </div>
      </div>
    </div>
  );
}
