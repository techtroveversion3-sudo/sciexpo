import "./index.css";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

const INTERNAL_COLLEGE = "Saveetha Institute of Medical And Technical Science";
const TEAM_SIZES = [2, 3, 4] as const;
const PROFILE_PATH = "/profile/";
const ADMIN_PATH = "/wasd4381/";
const WHATSAPP_COMMUNITY_URL = "https://chat.whatsapp.com/CIHaS5HmoGzIz3UqCf5Hz7";

type ParticipantType = "internal" | "external";
type Participation = "solo" | "team";

interface Participant {
  name: string;
  email: string;
  phone: string;
  registerNumber: string;
  college: string;
}

const emptyParticipant = (): Participant => ({
  name: "",
  email: "",
  phone: "",
  registerNumber: "",
  college: "",
});

function ParticipantRegistration() {
  const [participantType, setParticipantType] = useState<ParticipantType>("internal");
  const [participation, setParticipation] = useState<Participation>("solo");
  const [teamSize, setTeamSize] = useState(2);
  const [leader, setLeader] = useState<Participant>(emptyParticipant());
  const [members, setMembers] = useState<Participant[]>([
    emptyParticipant(),
    emptyParticipant(),
    emptyParticipant(),
  ]);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedRegistrationCode, setSubmittedRegistrationCode] = useState("");
  const [leaderGoogleEmail, setLeaderGoogleEmail] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const registrationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!supabase) {
      setAuthChecking(false);
      return;
    }

    let active = true;
    const applyLeaderSession = (session: Session | null) => {
      if (!active) return;
      const isGoogleUser = session?.user.app_metadata.provider === "google";
      const normalizedEmail = isGoogleUser ? session.user.email?.trim().toLowerCase() ?? "" : "";
      setLeaderGoogleEmail(normalizedEmail);
      setLeader((current) => ({ ...current, email: normalizedEmail }));
      setAuthError(session && !isGoogleUser ? "Sign in with Google to begin registration." : "");
      setAuthChecking(false);
    };

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      applyLeaderSession(session);
    });

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setAuthError(`Could not check Google sign-in: ${error.message}`);
        setAuthChecking(false);
        return;
      }
      applyLeaderSession(data.session);
    }).catch((error: unknown) => {
      if (!active) return;
      setAuthError(error instanceof Error ? error.message : "Could not check Google sign-in");
      setAuthChecking(false);
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const signInLeaderWithGoogle = async () => {
    if (!supabase) {
      setAuthError("Google sign-in is unavailable because Supabase is not configured.");
      return;
    }

    setAuthBusy(true);
    setAuthError("");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/`,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : "Google sign-in could not be started");
      setAuthBusy(false);
    }
  };

  const signOutLeader = async () => {
    if (!supabase) return;
    setAuthBusy(true);
    setAuthError("");
    const { error } = await supabase.auth.signOut();
    if (error) {
      setAuthError(`Could not sign out: ${error.message}`);
      setAuthBusy(false);
      return;
    }
    setAuthBusy(false);
  };

  const selectParticipantType = (type: ParticipantType) => {
    setParticipantType(type);
    setLeader((current) => ({ ...current, college: "", registerNumber: "" }));
    setMembers((current) =>
      current.map((member) => ({ ...member, college: "", registerNumber: "" })),
    );
    setErrors({});
  };

  const validateParticipant = (participant: Participant, prefix: string, errorsFound: Record<string, string>) => {
    if (!participant.name.trim()) errorsFound[`${prefix}.name`] = "Enter a full name";
    if (!participant.email.trim()) errorsFound[`${prefix}.email`] = "Enter a Gmail address";
    else if (!/^[^\s@]+@gmail\.com$/i.test(participant.email.trim())) {
      errorsFound[`${prefix}.email`] = "Enter a valid Gmail address";
    }
    if (!participant.phone.trim()) errorsFound[`${prefix}.phone`] = "Enter a phone number";
    else if (!/^\d{10}$/.test(participant.phone.replace(/\D/g, ""))) {
      errorsFound[`${prefix}.phone`] = "Enter a valid 10 digit phone number";
    }
    if (participantType === "internal" && !participant.registerNumber.trim()) {
      errorsFound[`${prefix}.registerNumber`] = "Enter a register number";
    }
    if (participantType === "external" && !participant.college.trim()) {
      errorsFound[`${prefix}.college`] = "Enter a college name";
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!leaderGoogleEmail) nextErrors.auth = "Sign in with Google before submitting your registration";
    validateParticipant(leader, "leader", nextErrors);

    const activeMembers = participation === "team" ? members.slice(0, teamSize - 1) : [];
    activeMembers.forEach((member, index) => {
      validateParticipant(member, `member${index + 2}`, nextErrors);
    });
    if (!termsAccepted) nextErrors.terms = "Please confirm that you agree to the event rules";

    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    if (!supabase) {
      setErrors({ form: "Registration is not connected yet. Please try again later." });
      return;
    }

    setSubmitting(true);
    setErrors({});

    const toDatabaseParticipant = (person: Participant) => ({
      name: person.name.trim(),
      email: person.email.trim(),
      phone: person.phone.trim(),
      reg_number: participantType === "internal" ? person.registerNumber.trim() : null,
      college: participantType === "internal" ? INTERNAL_COLLEGE : person.college.trim(),
    });

    const row = {
      participation_type: participantType,
      team_or_solo: participation,
      team_name: participation === "team" ? "Team Registration" : "Solo Registration",
      team_size: participation === "team" ? teamSize : 1,
      leader_name: leader.name.trim(),
      leader_email: leaderGoogleEmail,
      leader_phone: leader.phone.trim(),
      leader_reg_number: participantType === "internal" ? leader.registerNumber.trim() : null,
      leader_college: participantType === "internal" ? INTERNAL_COLLEGE : leader.college.trim(),
      members: activeMembers.map(toDatabaseParticipant),
      terms_accepted: termsAccepted,
    };

    try {
      const { data, error } = await supabase
        .from("registrations")
        .insert([row])
        .select("registration_code")
        .single();
      if (error) throw error;
      setSubmittedRegistrationCode(data.registration_code);
      setSubmitted(true);
    } catch (error: unknown) {
      setErrors({
        form: error instanceof Error ? error.message : "Registration could not be submitted",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const fieldError = (key: string) =>
    errors[key] ? <p className="field-error" role="alert">{errors[key]}</p> : null;

  const participantFields = (person: Participant, prefix: string, update: (next: Participant) => void) => (
    <div className="participant-fields">
      <label className="field">
        <span>Full name</span>
        <input
          autoComplete="name"
          value={person.name}
          onChange={(event) => update({ ...person, name: event.target.value })}
          placeholder="Enter full name"
          required
        />
        {fieldError(`${prefix}.name`)}
      </label>

      <label className="field">
        <span>Gmail address</span>
        <input
          type="email"
          autoComplete="email"
          value={person.email}
          onChange={(event) => update({ ...person, email: event.target.value })}
          placeholder="name@gmail.com"
          readOnly={prefix === "leader"}
          required
        />
        {fieldError(`${prefix}.email`)}
      </label>

      <label className="field">
        <span>Phone number</span>
        <input
          type="tel"
          autoComplete="tel"
          value={person.phone}
          onChange={(event) => update({ ...person, phone: event.target.value })}
          placeholder="10 digit phone number"
          required
        />
        {fieldError(`${prefix}.phone`)}
      </label>

      {participantType === "internal" ? (
        <>
          <div className="field">
            <span>College</span>
            <div className="fixed-value">{INTERNAL_COLLEGE}</div>
          </div>
          <label className="field">
            <span>Register number</span>
            <input
              value={person.registerNumber}
              onChange={(event) => update({ ...person, registerNumber: event.target.value })}
              placeholder="Enter register number"
              required
            />
            {fieldError(`${prefix}.registerNumber`)}
          </label>
        </>
      ) : (
        <label className="field">
          <span>College name</span>
          <input
            autoComplete="organization"
            value={person.college}
            onChange={(event) => update({ ...person, college: event.target.value })}
            placeholder="Enter college name"
            required
          />
          {fieldError(`${prefix}.college`)}
        </label>
      )}
    </div>
  );

  return (
    <main>
      <section className="hero">
        <a className="profile-link" href={PROFILE_PATH}>My profile</a>
        <div className="hero-content">
          <img
            className="simats-logo hero-logo"
            src="/simats-engineering-logo-white.png"
            alt="SIMATS Engineering"
          />
          <p className="event-label">Annual science exhibition</p>
          <h1>Science<br /><span>Expo 2026</span></h1>
          <p className="hero-summary">
            A day for curious minds to share ideas and explore the world of science.
          </p>
          <div className="event-date">
            <span>20 November 2026</span>
          </div>
          <button
            className="primary-button hero-button"
            type="button"
            onClick={() => registrationRef.current?.scrollIntoView({ behavior: "smooth" })}
          >
            Begin registration
          </button>
        </div>
        <div className="hero-caption">Ideas into discovery</div>
      </section>

      <section className="event-intro">
        <div className="section-kicker">Science Expo 2026</div>
        <h2>Bring your curiosity.<br /><span>Be part of the discovery.</span></h2>
        <p>
          Join us on 20 November 2026. Register as an internal or external participant,
          either on your own or in a team of up to four people including the team leader.
        </p>
        <div className="event-facts">
          <div><span>Event date</span><strong>20 November 2026</strong></div>
          <div><span>Participation</span><strong>Solo or team</strong></div>
          <div><span>Team size</span><strong>Up to four people</strong></div>
        </div>
        <a
          className="community-link"
          href={WHATSAPP_COMMUNITY_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Join the Science Expo WhatsApp community
        </a>
      </section>

      <section className="rules-section" aria-labelledby="rules-title">
        <div className="rules-wrap">
          <div className="section-kicker">Prototype project showcase</div>
          <h2 id="rules-title">Rules &amp; Regulations</h2>
          <p className="rules-intro">
            Please review the following requirements before registering your team and project.
          </p>

          <div className="rules-grid">
            <article className="rule-card">
              <h3>1. Team &amp; Registration</h3>
              <ul>
                <li>A team may have a maximum of four participants.</li>
                <li>Participation is free; no registration fee will be collected.</li>
                <li>Provide accurate participant and project details during registration.</li>
                <li>Designate one participant as team leader and primary point of contact.</li>
              </ul>
            </article>

            <article className="rule-card">
              <h3>2. Selection Process</h3>
              <ul>
                <li>
                  A selection round will take place before the excursion. Its date, time,
                  and submission details will be announced shortly.
                </li>
                <li>All registered teams must participate as instructed by the organisers.</li>
                <li>
                  The top 70 teams, based on evaluation, will be shortlisted for the
                  excursion and prototype showcase.
                </li>
                <li>Evaluation panel and organiser decisions are final.</li>
              </ul>
            </article>

            <article className="rule-card">
              <h3>3. Project &amp; Presentation</h3>
              <ul>
                <li>
                  Projects must be original, or appropriately acknowledge external sources,
                  references, and components.
                </li>
                <li>Teams should be ready to explain the problem, objectives, working principle, innovation, and practical applications.</li>
                <li>
                  Shortlisted teams must bring their prototype and required presentation
                  materials on the scheduled excursion date.
                </li>
                <li>
                  Teams are responsible for safely arranging and transporting prototypes,
                  components, and accessories.
                </li>
                <li>
                  Communicate any special power, internet, space, or equipment requirements
                  to the organisers in advance.
                </li>
              </ul>
            </article>

            <article className="rule-card">
              <h3>4. Conduct &amp; General Instructions</h3>
              <ul>
                <li>Follow the schedule and instructions communicated by the organisers.</li>
                <li>Maintain discipline, respect other teams, and handle the venue and equipment responsibly.</li>
                <li>
                  Prototypes must be safe to operate. Hazardous, illegal, or potentially
                  harmful materials are not permitted.
                </li>
                <li>
                  Organisers may modify the schedule or guidelines when necessary and will
                  communicate any changes to participants.
                </li>
              </ul>
            </article>
          </div>

          <aside className="rules-announcement" aria-label="Important announcement">
            <p className="section-kicker">Important Announcement</p>
            <p>The selection-round date and further instructions will be announced soon.</p>
            <strong>Only the 70 shortlisted teams will be invited to participate in the excursion showcase.</strong>
          </aside>
        </div>
      </section>

      <section className="registration-section" ref={registrationRef} id="register">
        <div className="registration-wrap">
          <div className="section-kicker">Participant registration</div>
          <h2>Save your place</h2>
          <p className="registration-intro">
            Enter the participant details below. All fields are required.
          </p>

          {!supabase && (
            <p className="connection-notice" role="status">
              Registration will be available when the event database is connected.
            </p>
          )}

          {authChecking ? (
            <div className="form-panel" role="status">Checking your Google sign-in…</div>
          ) : !leaderGoogleEmail ? (
            <div className="form-panel registration-auth-gate">
              <h3>Sign in to begin</h3>
              <p className="panel-description">
                Registration details are available after you sign in successfully with Google.
              </p>
              <button
                className="primary-button google-signin-button"
                type="button"
                onClick={signInLeaderWithGoogle}
                disabled={authBusy || !supabase}
              >
                {authBusy ? "Connecting to Google" : "Continue with Google"}
              </button>
              {authError && <p className="field-error" role="alert">{authError}</p>}
            </div>
          ) : submitted ? (
            <div className="success-panel" role="status">
              <p className="section-kicker">Registration received</p>
              <h3>Thank you for registering</h3>
              <p>Your details have been submitted for Science Expo 2026.</p>
              <p className="registration-code">
                Registration code: <strong>{submittedRegistrationCode || "Check your profile for the code"}</strong>
              </p>
              <a
                className="community-link"
                href={WHATSAPP_COMMUNITY_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Join the Science Expo WhatsApp community
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <div className="form-panel">
                <h3>Participant type</h3>
                <p className="panel-description">Choose the group you are registering with.</p>
                <div className="choice-row">
                  {(["internal", "external"] as const).map((type) => (
                    <button
                      type="button"
                      key={type}
                      aria-pressed={participantType === type}
                      className={`choice-button ${participantType === type ? "selected" : ""}`}
                      onClick={() => selectParticipantType(type)}
                    >
                      {type === "internal" ? "Saveetha student" : "External participant"}
                    </button>
                  ))}
                </div>
                <div className="participation-choice">
                  <label>
                    <input
                      type="radio"
                      name="participation"
                      checked={participation === "solo"}
                      onChange={() => setParticipation("solo")}
                    />
                    <span>Individual registration</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="participation"
                      checked={participation === "team"}
                      onChange={() => setParticipation("team")}
                    />
                    <span>Team registration</span>
                  </label>
                </div>
                {participation === "team" && (
                  <fieldset className="team-size">
                    <legend>Number of participants, including the leader</legend>
                    <div className="size-options">
                      {TEAM_SIZES.map((size) => (
                        <label key={size} className={teamSize === size ? "size-option selected" : "size-option"}>
                          <input
                            type="radio"
                            name="teamSize"
                            checked={teamSize === size}
                            onChange={() => setTeamSize(size)}
                          />
                          <span>{size}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
              </div>

              <div className="form-panel">
                <h3>{participation === "team" ? "Team leader" : "Your details"}</h3>
                <p className="panel-description">
                  {participantType === "internal"
                    ? "Sign in with Google, then enter the participant details and Saveetha register number."
                    : "Sign in with Google, then enter the participant details and college name."}
                </p>
                <div className="leader-google-signin">
                  {leaderGoogleEmail ? (
                    <>
                      <p className="google-account-status" role="status">
                        Google account connected: <strong>{leaderGoogleEmail}</strong>
                      </p>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={signOutLeader}
                        disabled={authBusy || submitting}
                      >
                        Use another Google account
                      </button>
                    </>
                  ) : (
                    <button
                      className="primary-button google-signin-button"
                      type="button"
                      onClick={signInLeaderWithGoogle}
                      disabled={authBusy || submitting || !supabase}
                    >
                      {authBusy ? "Connecting to Google" : "Continue with Google"}
                    </button>
                  )}
                  {authError && <p className="field-error" role="alert">{authError}</p>}
                  {fieldError("auth")}
                </div>
                {participantFields(leader, "leader", setLeader)}
              </div>

              {participation === "team" && members.slice(0, teamSize - 1).map((member, index) => (
                <div className="form-panel" key={index}>
                  <h3>Team member {index + 2}</h3>
                  <p className="panel-description">Enter this participant's details.</p>
                  {participantFields(member, `member${index + 2}`, (next) => {
                    setMembers((current) => current.map((item, itemIndex) => itemIndex === index ? next : item));
                  })}
                </div>
              ))}

              <div className="form-panel form-submit-panel">
                <label className="terms-check">
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(event) => setTermsAccepted(event.target.checked)}
                  />
                  <span>I agree to follow the rules and guidelines of Science Expo 2026.</span>
                </label>
                {fieldError("terms")}
                {errors.form && <p className="field-error" role="alert">{errors.form}</p>}
                <button className="primary-button submit-button" type="submit" disabled={submitting}>
                  {submitting ? "Submitting registration" : "Submit registration"}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>

      <footer className="site-footer">
        <img className="simats-logo footer-logo" src="/simats-engineering-logo-white.png" alt="SIMATS Engineering" />
        <span>Science Expo 2026</span>
        <a href={WHATSAPP_COMMUNITY_URL} target="_blank" rel="noopener noreferrer">
          Join our WhatsApp community
        </a>
      </footer>
    </main>
  );
}

const ADMIN_PREVIEW_MODE = import.meta.env.DEV;
const MAX_EMAIL_BATCH_SIZE = 15;

interface ParticipantRegistrationStatus {
  registration_code: string;
  created_at: string;
  participation_type: ParticipantType;
  team_or_solo: Participation;
  team_size: number;
}

function ParticipantProfile() {
  const [session, setSession] = useState<Session | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [registration, setRegistration] = useState<ParticipantRegistrationStatus | null>(null);
  const [loadingRegistration, setLoadingRegistration] = useState(false);
  const [registrationError, setRegistrationError] = useState("");
  const isGoogleUser = session?.user.app_metadata.provider === "google" && Boolean(session.user.email);

  useEffect(() => {
    if (!supabase) {
      setAuthChecking(false);
      return;
    }

    let active = true;
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setAuthError("");
      setAuthChecking(false);
    });

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setAuthError(`Could not check Google sign-in: ${error.message}`);
      } else {
        setSession(data.session);
      }
      setAuthChecking(false);
    }).catch((error: unknown) => {
      if (!active) return;
      setAuthError(error instanceof Error ? error.message : "Could not check Google sign-in.");
      setAuthChecking(false);
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (authChecking) return;
    const userEmail = session?.user.email;
    if (!supabase || !isGoogleUser || !userEmail) {
      setRegistration(null);
      setLoadingRegistration(false);
      setRegistrationError("");
      return;
    }

    let active = true;
    setLoadingRegistration(true);
    setRegistrationError("");
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("registrations")
          .select("registration_code, created_at, participation_type, team_or_solo, team_size")
          .eq("leader_email", userEmail.trim().toLowerCase())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (active) setRegistration(data);
      } catch (error: unknown) {
        if (active) {
          setRegistrationError(error instanceof Error ? error.message : "Could not load registration status.");
        }
      } finally {
        if (active) setLoadingRegistration(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [authChecking, isGoogleUser, session]);

  const signInWithGoogle = async () => {
    if (!supabase) {
      setAuthError("Google sign-in is unavailable because Supabase is not configured.");
      return;
    }

    setAuthBusy(true);
    setAuthError("");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}${PROFILE_PATH}`,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : "Google sign-in could not be started.");
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    if (!supabase) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setSession(null);
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? `Could not sign out: ${error.message}` : "Could not sign out.");
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <main className="profile-page">
      <header className="profile-header">
        <a href="/" className="profile-brand">Science Expo 2026</a>
        <a href="/" className="profile-back-link">Event home</a>
      </header>
      <section className="profile-content">
        <p className="section-kicker">Participant account</p>
        <h1>My profile</h1>
        <p className="profile-intro">Sign in with Google to view your Science Expo registration status.</p>

        {authChecking ? (
          <div className="profile-card" role="status">Checking your Google sign-in…</div>
        ) : !supabase ? (
          <div className="profile-card" role="alert">
            Google sign-in is unavailable because Supabase is not configured.
          </div>
        ) : !session ? (
          <div className="profile-card">
            <h2>Sign in to your profile</h2>
            <p>Your registration details are private and available only to the Google account used to register.</p>
            <button className="primary-button" type="button" onClick={signInWithGoogle} disabled={authBusy}>
              {authBusy ? "Connecting to Google…" : "Continue with Google"}
            </button>
            {authError && <p className="field-error" role="alert">{authError}</p>}
          </div>
        ) : !isGoogleUser ? (
          <div className="profile-card">
            <h2>Google sign-in required</h2>
            <p>This account did not sign in with Google. Sign in with Google to access participant registration.</p>
            <div className="profile-actions">
              <button className="primary-button" type="button" onClick={signInWithGoogle} disabled={authBusy}>
                {authBusy ? "Connecting to Google…" : "Continue with Google"}
              </button>
              <button className="secondary-button" type="button" onClick={signOut} disabled={authBusy}>
                Sign out
              </button>
            </div>
            {authError && <p className="field-error" role="alert">{authError}</p>}
          </div>
        ) : (
          <>
            <div className="profile-account">
              <span>Signed in as</span>
              <strong>{session.user.email}</strong>
              <button className="secondary-button" type="button" onClick={signOut} disabled={authBusy}>
                {authBusy ? "Signing out…" : "Sign out"}
              </button>
            </div>
            {registrationError ? (
              <div className="profile-card" role="alert">
                <h2>Could not load registration status</h2>
                <p>{registrationError}</p>
              </div>
            ) : loadingRegistration ? (
              <div className="profile-card" role="status">Loading your registration status…</div>
            ) : registration ? (
              <div className="profile-card registration-status-card">
                <p className="section-kicker">Registration status</p>
                <h2>Registration received</h2>
                <p>Your Science Expo 2026 registration has been submitted successfully.</p>
                <dl className="profile-registration-details">
                  <div><dt>Registration code</dt><dd>{registration.registration_code}</dd></div>
                  <div><dt>Submitted</dt><dd>{new Date(registration.created_at).toLocaleDateString("en-IN")}</dd></div>
                  <div><dt>Participation</dt><dd>{registration.participation_type === "internal" ? "Saveetha student" : "External participant"}</dd></div>
                  <div><dt>Registration type</dt><dd>{registration.team_or_solo === "team" ? `Team of ${registration.team_size}` : "Individual"}</dd></div>
                </dl>
                <a
                  className="community-link"
                  href={WHATSAPP_COMMUNITY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Join the Science Expo WhatsApp community
                </a>
              </div>
            ) : (
              <div className="profile-card">
                <p className="section-kicker">Registration status</p>
                <h2>Not registered yet</h2>
                <p>You are signed in with Google. You can now begin your Science Expo 2026 registration.</p>
                <a className="primary-button profile-register-button" href="/#register">Start registration</a>
              </div>
            )}
          </>
        )}
      </section>
      <footer className="site-footer">
        <img className="simats-logo footer-logo" src="/simats-engineering-logo-white.png" alt="SIMATS Engineering" />
        <span>Science Expo 2026</span>
        <a href={WHATSAPP_COMMUNITY_URL} target="_blank" rel="noopener noreferrer">
          Join our WhatsApp community
        </a>
      </footer>
    </main>
  );
}

interface AdminMember {
  name: string;
  email: string;
  phone: string;
  reg_number: string | null;
  college: string;
}

interface AdminRegistration {
  id?: number | string;
  registration_code: string | null;
  participation_type: ParticipantType;
  team_or_solo: Participation;
  team_name: string | null;
  team_size: number;
  leader_name: string;
  leader_email: string;
  leader_phone: string;
  leader_reg_number: string | null;
  leader_college: string;
  members: AdminMember[];
  terms_accepted: boolean;
  created_at: string;
}

const demoRegistrations: AdminRegistration[] = [
  {
    id: "demo-1",
    registration_code: "SE-DEMO-001",
    participation_type: "internal",
    team_or_solo: "team",
    team_name: "Team Registration",
    team_size: 2,
    leader_name: "Sample Student",
    leader_email: "student@gmail.com",
    leader_phone: "0000000000",
    leader_reg_number: "DEMO-001",
    leader_college: INTERNAL_COLLEGE,
    members: [{
      name: "Team Member",
      email: "member@gmail.com",
      phone: "0000000000",
      reg_number: "DEMO-002",
      college: INTERNAL_COLLEGE,
    }],
    terms_accepted: true,
    created_at: new Date().toISOString(),
  },
  {
    id: "demo-2",
    registration_code: "SE-DEMO-002",
    participation_type: "external",
    team_or_solo: "solo",
    team_name: "Solo Registration",
    team_size: 1,
    leader_name: "Demo Participant",
    leader_email: "participant@gmail.com",
    leader_phone: "0000000000",
    leader_reg_number: null,
    leader_college: "Example College",
    members: [],
    terms_accepted: true,
    created_at: new Date(Date.now() - 86400000).toISOString(),
  },
];

function AdminDashboard() {
  const [session, setSession] = useState<{ user: { app_metadata?: Record<string, unknown> } } | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [registrations, setRegistrations] = useState<AdminRegistration[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [activeView, setActiveView] = useState<"all" | "team" | "solo">("all");
  const [selected, setSelected] = useState<AdminRegistration | null>(null);
  const [draft, setDraft] = useState<AdminRegistration | null>(null);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [emailBusyId, setEmailBusyId] = useState<string | null>(null);
  const [selectedEmailIds, setSelectedEmailIds] = useState<string[]>([]);
  const [emailBatchBusy, setEmailBatchBusy] = useState(false);
  const [emailStatus, setEmailStatus] = useState("");
  const [emailError, setEmailError] = useState("");

  useEffect(() => {
    if (ADMIN_PREVIEW_MODE) {
      setRegistrations(demoRegistrations);
      setAuthorized(true);
      setAuthChecking(false);
      return;
    }

    if (!supabase) {
      setAuthError("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
      setAuthChecking(false);
      return;
    }

    let active = true;
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) setSession(nextSession);
    });

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setAuthError(`Could not restore the admin session: ${error.message}`);
      } else {
        setSession(data.session);
      }
      setAuthChecking(false);
    }).catch((error: unknown) => {
      if (!active) return;
      setAuthError(error instanceof Error ? error.message : "Could not restore the admin session.");
      setAuthChecking(false);
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (ADMIN_PREVIEW_MODE || authChecking) return;
    if (!session) {
      setAuthorized(false);
      return;
    }
    if (session.user.app_metadata?.role !== "admin") {
      setAuthorized(false);
      setAuthError("This Google account is not authorized to access the admin dashboard.");
      if (supabase) {
        supabase.auth.signOut().then(({ error }) => {
          if (error) setAuthError(`This account is not authorized, and sign-out failed: ${error.message}`);
        }).catch((error: unknown) => {
          setAuthError(error instanceof Error
            ? `This account is not authorized, and sign-out failed: ${error.message}`
            : "This account is not authorized, and sign-out failed.");
        });
      }
      return;
    }

    setAuthError("");
    setAuthorized(true);
    void loadRegistrations();
  }, [authChecking, session]);

  const loadRegistrations = async () => {
    if (ADMIN_PREVIEW_MODE) {
      setRegistrations(demoRegistrations);
      setDataError("");
      return;
    }
    if (!supabase) {
      setDataError("Supabase is not configured.");
      return;
    }
    setLoadingData(true);
    setDataError("");
    try {
      const { data, error } = await supabase
        .from("registrations")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRegistrations((data ?? []) as AdminRegistration[]);
    } catch (error: unknown) {
      setDataError(error instanceof Error ? error.message : "Could not load registrations.");
    } finally {
      setLoadingData(false);
    }
  };

  const signIn = async () => {
    if (!supabase) {
      setAuthError("Supabase is not configured.");
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}${ADMIN_PATH}`,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : "Google sign-in could not be started.");
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    if (!supabase) return;
    setAuthBusy(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setAuthorized(false);
      setSession(null);
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? `Could not sign out: ${error.message}` : "Could not sign out.");
    } finally {
      setAuthBusy(false);
    }
  };

  const sendRegistrationEmail = async (registration: AdminRegistration) => {
    if (typeof registration.id !== "string" || !registration.id) {
      setEmailError("This registration does not have a valid ID, so its email cannot be queued.");
      return;
    }
    if (ADMIN_PREVIEW_MODE) {
      setEmailError("Email queueing is unavailable in preview mode.");
      return;
    }
    if (!supabase) {
      setEmailError("Email sending is unavailable because Supabase is not configured.");
      return;
    }

    setEmailBusyId(registration.id);
    setEmailStatus("");
    setEmailError("");
    try {
      const { data, error } = await supabase.functions.invoke("admin-send-registration-email", {
        body: { registration_id: registration.id },
      });
      if (error) throw error;
      if (data?.status === "sending") {
        throw new Error("This registration email is already being sent. Try again shortly.");
      }
      if (data?.status !== "queued") {
        throw new Error("The email was not queued. Please try again.");
      }
      setEmailStatus(
        `Confirmation email for ${registration.leader_name || registration.leader_email} queued. ` +
        "The scheduled email worker processes queued messages, usually within five minutes.",
      );
    } catch (error: unknown) {
      setEmailError(error instanceof Error ? error.message : "Could not queue the confirmation email.");
    } finally {
      setEmailBusyId(null);
    }
  };

  const toggleEmailSelection = (registration: AdminRegistration, checked: boolean) => {
    const registrationId = registration.id;
    if (typeof registrationId !== "string" || !registrationId) return;

    setEmailStatus("");
    setEmailError("");
    if (!checked) {
      setSelectedEmailIds((current) => current.filter((id) => id !== registrationId));
      return;
    }
    if (selectedEmailIds.includes(registrationId)) return;
    if (selectedEmailIds.length >= MAX_EMAIL_BATCH_SIZE) {
      setEmailError(`A batch can contain at most ${MAX_EMAIL_BATCH_SIZE} registrations.`);
      return;
    }
    setSelectedEmailIds((current) => [...current, registrationId]);
  };

  const queueEmailBatch = async () => {
    if (!selectedEmailIds.length) return;
    if (ADMIN_PREVIEW_MODE) {
      setEmailError("Email batch queueing is unavailable in preview mode.");
      return;
    }
    if (!supabase) {
      setEmailError("Email batch queueing is unavailable because Supabase is not configured.");
      return;
    }

    setEmailBatchBusy(true);
    setEmailStatus("");
    setEmailError("");
    try {
      const { data, error } = await supabase.functions.invoke("admin-send-registration-email", {
        body: { registration_ids: selectedEmailIds },
      });
      if (error) throw error;

      const queuedCount = Number(data?.queued_count);
      if (!Number.isInteger(queuedCount) || queuedCount < 1) {
        throw new Error("No registrations in this batch could be queued.");
      }

      setEmailStatus(
        `Queued ${queuedCount} of ${selectedEmailIds.length} selected emails as one batch. ` +
        "The scheduled worker sends that batch together, subject to the daily limit.",
      );
      if (queuedCount < selectedEmailIds.length) {
        const remainingIds = Array.isArray(data?.results)
          ? data.results
            .filter((result: { status?: unknown }) => result?.status !== "queued")
            .map((result: { registration_id?: unknown }) => result?.registration_id)
            .filter((id: unknown): id is string => typeof id === "string")
          : selectedEmailIds;
        setSelectedEmailIds(remainingIds);
        setEmailError(
          `${selectedEmailIds.length - queuedCount} registration(s) were not queued because they may already be sending or could not be found.`,
        );
      } else {
        setSelectedEmailIds([]);
      }
    } catch (error: unknown) {
      setEmailError(error instanceof Error ? error.message : "Could not queue the email batch.");
    } finally {
      setEmailBatchBusy(false);
    }
  };

  const filteredRegistrations = registrations.filter((registration) => {
    if (activeView === "team" && registration.team_or_solo !== "team") return false;
    if (activeView === "solo" && registration.team_or_solo !== "solo") return false;
    if (typeFilter && registration.participation_type !== typeFilter) return false;
    const query = search.trim().toLowerCase();
    if (!query) return true;
    const searchable = [
      registration.registration_code,
      registration.leader_name,
      registration.leader_email,
      registration.leader_phone,
      registration.leader_college,
      registration.leader_reg_number,
      registration.team_name,
      ...registration.members.flatMap((member) => [
        member.name,
        member.email,
        member.phone,
        member.reg_number,
        member.college,
      ]),
    ].filter(Boolean).join(" ").toLowerCase();
    return searchable.includes(query);
  });

  const exportCsv = () => {
    if (!registrations.length) return;
    const headers = [
      "Registration Code", "Participant Type", "Participation", "Participant Count",
      "Leader Name", "Leader Gmail", "Leader Phone", "Leader Reg Number",
      "Leader College", "Team Members", "Rules Accepted", "Registration Date",
    ];
    const csvRows = [headers.join(",")];
    registrations.forEach((registration) => {
      const values = [
        registration.registration_code || "",
        registration.participation_type,
        registration.team_or_solo,
        registration.team_size,
        registration.leader_name,
        registration.leader_email,
        registration.leader_phone,
        registration.leader_reg_number || "",
        registration.leader_college,
        registration.members.map((member) => member.name).join("; "),
        registration.terms_accepted ? "Yes" : "No",
        registration.created_at,
      ];
      csvRows.push(values.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","));
    });
    const url = URL.createObjectURL(new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `science-expo-registrations-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const startEditing = () => {
    if (!selected) return;
    setSaveError("");
    setDraft({
      ...selected,
      members: selected.members.map((member) => ({ ...member })),
    });
  };

  const updateMember = (index: number, patch: Partial<AdminMember>) => {
    setDraft((current) => current ? ({
      ...current,
      members: current.members.map((member, memberIndex) =>
        memberIndex === index ? { ...member, ...patch } : member),
    }) : current);
  };

  const addMember = () => {
    setDraft((current) => {
      if (!current || current.members.length >= 3) return current;
      return {
        ...current,
        team_or_solo: "team",
        team_name: "Team Registration",
        members: [...current.members, {
          name: "",
          email: "",
          phone: "",
          reg_number: current.participation_type === "internal" ? "" : null,
          college: current.participation_type === "internal" ? INTERNAL_COLLEGE : "",
        }],
        team_size: current.members.length + 2,
      };
    });
  };

  const saveRegistration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || !selected) return;
    const people = [
      {
        name: draft.leader_name,
        email: draft.leader_email,
        phone: draft.leader_phone,
        reg_number: draft.leader_reg_number,
        college: draft.leader_college,
      },
      ...draft.members,
    ];
    const valid = people.every((person) =>
      person.name.trim() &&
      /^[^\s@]+@gmail\.com$/i.test(person.email.trim()) &&
      /^\d{10}$/.test(person.phone.replace(/\D/g, "")) &&
      (draft.participation_type === "internal"
        ? Boolean(person.reg_number?.trim())
        : Boolean(person.college?.trim())));
    if (!valid) {
      setSaveError("Check every participant has a name, valid Gmail address, 10-digit phone number, and required register number or college.");
      return;
    }

    const updated: AdminRegistration = {
      ...draft,
      team_or_solo: draft.members.length ? "team" : "solo",
      team_name: draft.members.length ? "Team Registration" : "Solo Registration",
      team_size: draft.members.length + 1,
      leader_college: draft.participation_type === "internal" ? INTERNAL_COLLEGE : draft.leader_college.trim(),
      leader_reg_number: draft.participation_type === "internal" ? draft.leader_reg_number?.trim() || null : null,
      members: draft.members.map((member) => ({
        ...member,
        college: draft.participation_type === "internal" ? INTERNAL_COLLEGE : member.college.trim(),
        reg_number: draft.participation_type === "internal" ? member.reg_number?.trim() || null : null,
      })),
    };

    setSaving(true);
    setSaveError("");
    try {
      if (!ADMIN_PREVIEW_MODE) {
        if (!supabase || !selected.id) throw new Error("Cannot save: Supabase registration is unavailable.");
        const { id: _id, ...updatedFields } = updated;
        const { error } = await supabase
          .from("registrations")
          .update(updatedFields)
          .eq("id", selected.id);
        if (error) throw error;
      }
      setRegistrations((current) => current.map((registration) =>
        registration.id === selected.id ? updated : registration));
      setSelected(updated);
      setDraft(null);
    } catch (error: unknown) {
      setSaveError(error instanceof Error ? error.message : "Could not save registration changes.");
    } finally {
      setSaving(false);
    }
  };

  if (!authorized) {
    return (
      <main className="admin-login-screen">
        <section className="admin-login-card">
          <h1>Science Expo 2026</h1>
          <p>Admin Dashboard</p>
          <p>Sign in with an authorized administrator Google account.</p>
          {authChecking && <p role="status">Checking your session…</p>}
          {authError && <p className="admin-error" role="alert">{authError}</p>}
          {!authChecking && (
            <button className="admin-btn" type="button" onClick={signIn} disabled={authBusy || !supabase}>
              {authBusy ? "Connecting to Google…" : "Continue with Google"}
            </button>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="admin-app">
      {ADMIN_PREVIEW_MODE && (
        <div className="admin-preview-notice">
          Preview mode. Sample registrations only. Live participant data is not loaded.
        </div>
      )}
      <header className="admin-topbar">
        <h1>Science Expo Admin</h1>
        <div className="admin-topbar-actions">
          <button className="admin-btn admin-btn-outline admin-btn-sm" type="button" onClick={exportCsv}>Export registrations</button>
          <button className="admin-btn admin-btn-outline admin-btn-sm" type="button" onClick={() => void loadRegistrations()} disabled={loadingData}>Refresh</button>
          {!ADMIN_PREVIEW_MODE && (
            <button className="admin-btn admin-btn-outline admin-btn-sm" type="button" onClick={() => void signOut()} disabled={authBusy}>Logout</button>
          )}
        </div>
      </header>

      <div className="admin-container">
        <p className="admin-email-help">
          Select up to {MAX_EMAIL_BATCH_SIZE} registrations and queue them as one email batch. The scheduled worker sends each selected batch together.
        </p>
        <section className="admin-stats-row" aria-label="Registration totals">
          {[
            ["Total Registrations", registrations.length],
            ["Internal", registrations.filter((registration) => registration.participation_type === "internal").length],
            ["External", registrations.filter((registration) => registration.participation_type === "external").length],
            ["Solo", registrations.filter((registration) => registration.team_or_solo === "solo").length],
            ["Team", registrations.filter((registration) => registration.team_or_solo === "team").length],
          ].map(([label, value]) => (
            <div className="admin-stat-card" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </section>

        <div className="admin-tabs" role="tablist" aria-label="Registration views">
          {([
            ["all", "All registrations"],
            ["team", "Team details"],
            ["solo", "Solo registrations"],
          ] as const).map(([view, label]) => (
            <button
              className={activeView === view ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={activeView === view}
              key={view}
              onClick={() => setActiveView(view)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="admin-filters">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search names, email, or registration code"
            aria-label="Search registrations"
          />
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            aria-label="Filter by participant type"
          >
            <option value="">All participant types</option>
            <option value="internal">Internal</option>
            <option value="external">External</option>
          </select>
        </div>

        <div className="admin-batch-toolbar">
          <div>
            <strong>{selectedEmailIds.length} / {MAX_EMAIL_BATCH_SIZE} selected</strong>
            <span>Choose registration rows to send together.</span>
          </div>
          <div className="admin-batch-actions">
            <button
              className="admin-btn"
              type="button"
              onClick={() => void queueEmailBatch()}
              disabled={!selectedEmailIds.length || emailBatchBusy || emailBusyId !== null || ADMIN_PREVIEW_MODE}
              title={ADMIN_PREVIEW_MODE ? "Batch sending is disabled for sample registrations" : undefined}
            >
              {emailBatchBusy ? "Queueing batch…" : "Queue selected batch"}
            </button>
            <button
              className="admin-btn admin-btn-outline"
              type="button"
              onClick={() => {
                setSelectedEmailIds([]);
                setEmailStatus("");
                setEmailError("");
              }}
              disabled={!selectedEmailIds.length || emailBatchBusy}
            >
              Clear selection
            </button>
          </div>
        </div>
        {ADMIN_PREVIEW_MODE && (
          <p className="admin-member-hint">Preview mode: sample registrations can be selected, but no email will be queued.</p>
        )}
        {emailStatus && <p className="admin-status" role="status">{emailStatus}</p>}
        {emailError && <p className="admin-error" role="alert">{emailError}</p>}
        {(dataError || loadingData) && (
          <p className={dataError ? "admin-error" : "admin-status"} role={dataError ? "alert" : "status"}>
            {dataError || "Loading registrations…"}
          </p>
        )}
        <div className="admin-table-wrap" role="region" aria-label="Registration results" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Batch</th><th>Code</th><th>Type</th><th>Participation</th><th>Participant Count</th>
                <th>Participants</th><th>Leader Email</th><th>Leader Phone</th>
                <th>College</th><th>Created At</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRegistrations.length === 0 ? (
                <tr><td className="admin-empty-state" colSpan={11}>No registrations found.</td></tr>
              ) : filteredRegistrations.map((registration) => (
                <tr key={registration.id ?? registration.registration_code}>
                  <td data-label="Email batch">
                    <label className="admin-select-control">
                      <input
                        type="checkbox"
                        checked={typeof registration.id === "string" && selectedEmailIds.includes(registration.id)}
                        onChange={(event) => toggleEmailSelection(registration, event.target.checked)}
                        disabled={typeof registration.id !== "string" || emailBatchBusy}
                        aria-label={`Select ${registration.leader_name || registration.leader_email} for the email batch`}
                      />
                      <span>Select</span>
                    </label>
                  </td>
                  <td data-label="Code">{registration.registration_code || "Not assigned"}</td>
                  <td data-label="Type"><span className={`admin-badge ${registration.participation_type}`}>
                    {registration.participation_type}
                  </span></td>
                  <td data-label="Participation">{registration.team_or_solo === "team" ? "Team" : "Individual"}</td>
                  <td data-label="Participant Count">{registration.team_size || registration.members.length + 1}</td>
                  <td data-label="Participants">
                    <div className="admin-participant-names">
                      <strong>{registration.leader_name || "Not provided"} (Leader)</strong>
                      {registration.members.map((member, index) => (
                        <span key={`${registration.id ?? registration.registration_code}-member-${index}`}>
                          {member.name || "Not provided"}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td data-label="Leader Email">{registration.leader_email || "Not provided"}</td>
                  <td data-label="Leader Phone">{registration.leader_phone || "Not provided"}</td>
                  <td data-label="College">{registration.leader_college || "Not provided"}</td>
                  <td data-label="Created At">{registration.created_at
                    ? new Date(registration.created_at).toLocaleDateString("en-IN", {
                      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
                    })
                    : "Not available"}</td>
                  <td data-label="Actions">
                    <div className="admin-row-actions">
                      <button className="admin-btn admin-btn-outline admin-btn-sm" type="button" onClick={() => {
                        setSelected(registration);
                        setDraft(null);
                        setSaveError("");
                        setEmailStatus("");
                        setEmailError("");
                      }}>View</button>
                      <button
                        className="admin-btn admin-btn-outline admin-btn-sm"
                        type="button"
                        onClick={() => void sendRegistrationEmail(registration)}
                        disabled={ADMIN_PREVIEW_MODE || emailBusyId === registration.id || emailBatchBusy}
                        title={ADMIN_PREVIEW_MODE ? "Email queueing is disabled for sample registrations" : undefined}
                      >
                        {ADMIN_PREVIEW_MODE
                          ? "Email unavailable"
                          : emailBusyId === registration.id ? "Queueing…" : "Queue email"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="admin-modal-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setSelected(null);
            setDraft(null);
          }
        }}>
          <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title">
            <h2 id="admin-modal-title">
              {draft ? "Edit Registration" : "Registration Details"}
              <button className="admin-modal-close" type="button" onClick={() => {
                setSelected(null);
                setDraft(null);
              }}>Close</button>
            </h2>
            {draft ? (
              <form onSubmit={saveRegistration}>
                <section className="admin-detail-section">
                  <h3>{draft.team_or_solo === "team" ? "Team Leader" : "Participant"}</h3>
                  <div className="admin-edit-grid">
                    <label>Full Name<input required value={draft.leader_name} onChange={(event) => setDraft({ ...draft, leader_name: event.target.value })} /></label>
                    <label>Gmail Address<input required type="email" value={draft.leader_email} onChange={(event) => setDraft({ ...draft, leader_email: event.target.value })} /></label>
                    <label>Phone<input required type="tel" value={draft.leader_phone} onChange={(event) => setDraft({ ...draft, leader_phone: event.target.value })} /></label>
                    {draft.participation_type === "internal" ? (
                      <>
                        <label>Register Number<input required value={draft.leader_reg_number || ""} onChange={(event) => setDraft({ ...draft, leader_reg_number: event.target.value })} /></label>
                        <label>College<input value={INTERNAL_COLLEGE} disabled /></label>
                      </>
                    ) : (
                      <label>College<input required value={draft.leader_college} onChange={(event) => setDraft({ ...draft, leader_college: event.target.value })} /></label>
                    )}
                  </div>
                </section>

                <section className="admin-detail-section">
                  <h3>Team Members. {draft.members.length} of 3 additional members</h3>
                  {draft.members.map((member, index) => (
                    <div className="admin-member-edit" key={index}>
                      <h4>Member {index + 2}</h4>
                      <div className="admin-edit-grid">
                        <label>Full Name<input required value={member.name} onChange={(event) => updateMember(index, { name: event.target.value })} /></label>
                        <label>Gmail Address<input required type="email" value={member.email} onChange={(event) => updateMember(index, { email: event.target.value })} /></label>
                        <label>Phone<input required type="tel" value={member.phone} onChange={(event) => updateMember(index, { phone: event.target.value })} /></label>
                        {draft.participation_type === "internal" ? (
                          <>
                            <label>Register Number<input required value={member.reg_number || ""} onChange={(event) => updateMember(index, { reg_number: event.target.value })} /></label>
                            <label>College<input value={INTERNAL_COLLEGE} disabled /></label>
                          </>
                        ) : (
                          <label>College<input required value={member.college} onChange={(event) => updateMember(index, { college: event.target.value })} /></label>
                        )}
                      </div>
                    </div>
                  ))}
                  {draft.members.length < 3 && (
                    <button className="admin-btn admin-btn-outline admin-btn-sm" type="button" onClick={addMember}>Add team member</button>
                  )}
                  <p className="admin-member-hint">Maximum team size is four people, including the leader.</p>
                </section>
                {saveError && <p className="admin-error" role="alert">{saveError}</p>}
                <div className="admin-modal-actions">
                  <button className="admin-btn admin-btn-outline" type="button" onClick={() => {
                    setDraft(null);
                    setSaveError("");
                  }}>Cancel</button>
                  <button className="admin-btn" type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
                </div>
              </form>
            ) : (
              <>
                <div className="admin-detail-grid">
                  <AdminDetail label="Registration code" value={selected.registration_code || "Not assigned"} />
                  <AdminDetail label="Participant type" value={selected.participation_type} />
                  <AdminDetail label="Participation" value={selected.team_or_solo === "team" ? "Team" : "Individual"} />
                  <AdminDetail label="Number of participants" value={String(selected.team_size || selected.members.length + 1)} />
                </div>
                <section className="admin-detail-section">
                  <h3>Leader Info</h3>
                  <div className="admin-detail-grid">
                    <AdminDetail label="Name" value={selected.leader_name} />
                    <AdminDetail label="Gmail address" value={selected.leader_email} />
                    <AdminDetail label="Phone" value={selected.leader_phone} />
                    {selected.participation_type === "internal" && <AdminDetail label="Register number" value={selected.leader_reg_number || "Not provided"} />}
                    <AdminDetail label="College" value={selected.leader_college} />
                  </div>
                </section>
                {selected.members.length > 0 && (
                  <section className="admin-detail-section">
                    <h3>Team Members</h3>
                    {selected.members.map((member, index) => (
                      <div className="admin-member-card" key={index}>
                        <strong>Member {index + 2}: {member.name || "Not provided"}</strong>
                        <p>Gmail address: {member.email || "Not provided"}<br />
                          Phone: {member.phone || "Not provided"}<br />
                          {selected.participation_type === "internal" && <>Register number: {member.reg_number || "Not provided"}<br /></>}
                          College: {member.college || "Not provided"}</p>
                      </div>
                    ))}
                  </section>
                )}
                <section className="admin-detail-section">
                  <div className="admin-detail-grid">
                    <AdminDetail label="Rules accepted" value={selected.terms_accepted ? "Yes" : "No"} />
                    <AdminDetail label="Registration date" value={selected.created_at ? new Date(selected.created_at).toLocaleString("en-IN") : "Not available"} />
                  </div>
                </section>
                <div className="admin-modal-actions">
                  {emailStatus && <p className="admin-status" role="status">{emailStatus}</p>}
                  {emailError && <p className="admin-error" role="alert">{emailError}</p>}
                  <button
                    className="admin-btn admin-btn-outline"
                    type="button"
                    onClick={() => void sendRegistrationEmail(selected)}
                    disabled={ADMIN_PREVIEW_MODE || emailBusyId === selected.id || !selected.id}
                    title={ADMIN_PREVIEW_MODE ? "Email queueing is disabled for sample registrations" : undefined}
                  >
                    {ADMIN_PREVIEW_MODE
                      ? "Email unavailable in preview"
                      : emailBusyId === selected.id ? "Queueing email…" : "Queue confirmation email"}
                  </button>
                  <button className="admin-btn" type="button" onClick={startEditing}>Edit details</button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function AdminDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-detail-item">
      <span>{label}</span>
      <strong>{value || "Not provided"}</strong>
    </div>
  );
}

export default function App() {
  const path = `${window.location.pathname.replace(/\/+$/, "")}/`;
  if (path === ADMIN_PATH) return <AdminDashboard />;
  if (path === PROFILE_PATH) return <ParticipantProfile />;
  return <ParticipantRegistration />;
}
