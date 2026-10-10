"use strict";
// Staged public grammar only. This is validation, never identity authority.
const ACTOR_PROTOCOL = "accounts.canonical.1";
const DISCORD_SUBJECT = /^\d{17,20}$/;
const STUDIO_ACTOR = /^studio:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isDiscordSubject = value => typeof value === "string" && DISCORD_SUBJECT.test(value);
const actorId = value => typeof value === "string" && (DISCORD_SUBJECT.test(value) || STUDIO_ACTOR.test(value)) ? value : null;
module.exports = Object.freeze({ ACTOR_PROTOCOL, actorId, isDiscordSubject });
