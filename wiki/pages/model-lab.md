# Models, performance and usage

Use **Agents › Models** to browse models and compare how they perform on your work. **Agents › Usage** shows recorded calls and any account limits Studio can read.

Opening these pages does not run a paid model test.

## Browse the catalog

Open **Agents › Models › Catalog**, or press `1`. Search by name, filter the cards and sort them by the qualities that matter to your project.

A card brings together model information such as context size, supported inputs, published benchmarks, pricing and privacy notes. Expand a model for more detail. **Print / PDF** makes a printable copy of the catalog.

Catalog entries are a reference. They do not determine your provider's bill, and prices or plan limits can change. Use your provider's current account page to confirm what your account includes.

## Compare your results

Open **Agents › Models › Performance**, or press `2`. This page uses calls Studio has recorded, including response time, token speed, errors and available usage figures.

Filter by task type to make the comparison more relevant. A model that works well for short summaries may behave differently on a long coding task.

You can add your own rating and a note to a recorded call. Your ratings remain separate from model-generated ratings. Missing measurements stay blank instead of counting as zero.

Performance results help you choose a model; browsing them does not change the models assigned to your team. Change those in **Agents › Setup**. [Connections and providers](connections.md) covers the setup.

## Check usage

**Agents › Usage** has two views:

- **Recorded calls** shows the usage Studio has captured from its own requests and supported coding sessions.
- **Provider accounts** shows quota, balance or usage returned by supported provider APIs.

The two views answer different questions. Recorded calls describe the work Studio can see. Account readings describe the provider's account and may include other activity.

Some CLI routes and subscription services do not report tokens or a per-call price. **Unpriced** means no price was reported; it does not mean the call was free.

You can also open a compact summary from **Usage** in Command view.

## Preview a task's context

Open **Agents › Workflows › Context**, choose a task and select a preview budget. **Preview context** shows what saved material fits, what is shortened and what is left out.

Token counts are estimates. Changing the preview budget does not alter the original task notes.

## Run a speed probe

For a quick timing measurement, open **Settings › System › Diagnostics**, choose a model under **Speed probe**, then press **Measure tokens/s**.

This sends one small request through the selected provider. It may use your quota or incur a charge. The result appears on the model's catalog card, with details in the Connection log.
