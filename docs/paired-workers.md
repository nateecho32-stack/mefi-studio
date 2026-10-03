# Paired repository checks

The first paired-worker profile runs six fixed Studio repository checks at an
exact Git commit. It is an opt-in coordinator and worker slice, not a distributed
coding-agent executor. It does not call providers, install dependencies, edit
the source checkout, push commits or publish releases.

Open Friends > Your PCs > Paired repository checks in a Studio repository with
a saved commit and matching GitHub origin. Unsaved source changes are retained
but are not part of a queued assignment.

## Local qualification and live activation

Loopback mode binds only 127.0.0.1. It can qualify the protocol on one computer;
it does not make the coordinator reachable from another PC. Start coordinator,
pairing, worker start and queueing each have a native confirmation with Cancel
selected by default. Merely opening the section reads local state.

For another PC, the owner must first provide a reachable HTTPS address with a
certificate that the worker normally trusts. Choose HTTPS mode and the PEM
certificate and key on the coordinator, or use an existing trusted HTTPS reverse
proxy with a loopback backend. Studio does not create a tunnel, change a firewall
or router, install trust roots or bypass certificate checks. Public exposure and
network access decisions are separate owner steps. No such access is activated
by the implementation or its tests.

1. On the always-on coordinator, open the intended Studio project, choose the
   connection mode and port, and explicitly confirm Start coordinator.
2. Select Pair another PC. Share the complete one-use code only with that PC.
   The code expires after five minutes. Closing setup clears its displayed code.
3. On the worker, open its approved Studio checkout, paste the code, and confirm
   Pair this PC. The worker credential is stored using encrypted local storage;
   pairing is unavailable when encryption is unavailable. Provider credentials
   remain on their original computers.
4. Confirm Start worker. On the coordinator, confirm Queue this project's saved
   commit. The worker makes a fresh checkout at that SHA and runs targets, spec
   collisions, CSS merge, unused CSS, syntax and TESTRUNS checks.
5. Stop worker and coordinator when finished. After an app restart, services
   remain off until explicitly started again. Pairing and journals remain local.

The coordinator never supplies a shell command or local filesystem path. The
worker maps its approved repository locally. It uses existing Git access only
when the assigned commit is absent locally and the source origin matches that
repository. The profile requires Git and the runtime already available on the
worker. Repository check scripts execute code from the approved repository, so
pair only workers and repositories the owner intends to trust.

## Recovery and bounds

Queue identity includes repository, exact commit and profile. Queueing the same
identity returns its existing job. A worker journals a claim before requesting
a persisted start grant. Lost acknowledgements, expired 30-second leases and
restart ambiguity are held uncertain. They are never automatically requeued or
executed by a replacement worker. Finished results are persisted before sending;
resending the same result is idempotent. A worker reconnects in its current
session, with overlapping instances rejected while the prior session is live.

When recovery says Confirm previous check stopped, first verify or stop the
previous process on that worker. Confirming records interruption, not success
or an automatic retry. This first version has no terminal-job retry control;
queueing the same commit again still returns its original job. Revoked workers
cannot reconnect; their in-flight assignments remain held. Keep the prior
worker journal and checkout for diagnosis, including after forgetting pairing.

The registry retains up to 16 registrations, including revoked ones. The queue
and worker journal retain up to 1,000 jobs and refuse further additions rather
than silently deleting history. The UI pages 30 jobs, keeps 20 recent progress
lines of up to 800 characters, and pages older lines from 128 KiB archive chunks.
Results are limited to 4,000 characters. Request and response bodies are bounded
to 16 KiB and 32 KiB. Older progress has next and previous pages; loading a page
keeps only its 20 lines in the UI. A command deadline settles without waiting
indefinitely for a close event and holds the job for process recovery. Success
after a lost result reply is reconciled only with a persisted start grant.
Writes use flushed temporary files and atomic replacement;
this qualifies process restart recovery, not every power-loss/filesystem failure.

Qualification uses temporary storage, real HTTP loopback transport, simulated
runner failures, real Git/Node exact-commit checks, and a real Chromium UI with
a simulated bridge. It does not establish real LAN or cross-network operation,
a persistent owner access grant, or distributed AI delegation.
