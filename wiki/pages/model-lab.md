# Model Lab and usage

Use **Agents › Models** to browse models and compare how they do on your own work. **Agents › Usage** shows the calls Studio recorded and any account readings it can get.

Opening these pages never runs a paid model test.

## Browse the catalog

Open **Agents › Models › Catalog**, or press `1`. Search by name, filter the cards and sort them by what matters for your project.

A card brings together a model's details, such as its context size, the inputs it takes, published benchmarks, pricing and privacy notes. Expand a model for more. **Catalog insights** charts the published benchmarks, and **Print / PDF** makes a printable copy of the catalog.

The catalog is a reference. It doesn't set your provider's bill, and prices or plan limits can change, so check your provider's own account page for what your plan includes.

## Compare your results

Open **Agents › Models › Performance**, or press `2`. It uses the calls Studio recorded: response time, token speed, errors and any usage figures the provider sent.

Filter by **Task type** to make the comparison fair. A model that's good at short summaries may do differently on a long coding task.

Under **Rate recent work**, you can score a result you've reviewed and add a note. Your score stays separate from model judging and error counts. Missing measurements stay blank instead of counting as zero.

The **Compare models on one brief** view is <span class="status planned">Planned</span>: it doesn't run any comparisons yet.

Browsing results doesn't change the models your team uses. Change those in **Agents › Setup**, as [Connect an AI](connections.md) explains.

## How Studio picks a builder's model

On the z.ai and OpenCode Go routes, with no builder model pinned, the **Auto** build tier picks a model for each task. Studio records every builder attempt as a win or a loss for its model and kind of work, and the model most likely to succeed builds. Other routes use the coding tool's own default model.

You choose where those strengths come from under **Mefi's permissions › Learning**, in Vibe's **Settings** panel or your companion's settings. **Learn model strengths from** can be **This project + others** (the default), **This project**, **All projects** or **Off**.

## Check usage

**Agents › Usage** has two views:

- **Recorded calls** shows the usage Studio captured from its own requests and from supported coding sessions.
- **Provider accounts** shows the quota, balance or usage that supported providers report. Refreshing sends no prompts.

The two answer different questions. Recorded calls cover the work Studio can see. Account readings describe your whole account with the provider, which may include other activity.

Some CLI routes and subscriptions don't report tokens or a price per call. An **Unpriced calls** count means no price was reported, not that the calls were free.

Command view's **Usage** pill gives a quick summary, with **Refresh** and **Details**.

> <span class="status next">New in 0.5</span> Empty cells read **Not reported** instead of "Unknown". Performance, Usage and Context each get their own subtitle, and pages leave out values that were never recorded. With [more than one Claude Code or Codex login](connections.md#more-than-one-login), each login gets its own row under **Provider accounts**.

## Preview a task's context

Open **Agents › Workflows › Context**, choose a task and a preview budget. **Preview context** shows what saved material fits, what gets shortened and what's left out.

Token counts are estimates. Changing the preview budget doesn't change the task's own notes.

## Run a speed probe

For a quick timing, open **Settings › System › Diagnostics**, choose a model under **Speed probe**, then press **Measure tokens/s**.

This sends one small request through the selected provider, so it may use your quota or cost money. The result shows on the model's catalog card, with each step in the Connection log. See [Trace, logs and diagnostics](trace.md).
