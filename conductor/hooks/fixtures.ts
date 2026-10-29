// GENERATED from ../routes.default.json and ../../.scratch/labels_dev.json: tests cannot read files.
// Regenerate after editing routes.default.json (see conductor/.scratch/gen_fixtures.py).
export const ROUTES_TEXT = "{\n  \"version\": 1,\n  \"classes\": {\n    \"skeptic2\": {\n      \"model\": \"fable\", \"effort\": \"high\", \"mode\": \"enforce\", \"overrides_agent\": true,\n      \"keywords\": [\"second skeptic\", \"2nd skeptic\", \"skeptic 2\", \"skeptic2\", \"second adversarial\"]\n    },\n    \"verdict\": {\n      \"model\": \"opus\", \"effort\": \"xhigh\", \"mode\": \"enforce\", \"overrides_agent\": true, \"demote_to\": \"review\",\n      \"strong_keywords\": [\"skeptic*\", \"refut*\", \"adversarial*\", \"gauntlet*\", \"overfit*\", \"prereg gate*\"],\n      \"keywords\": [\n        \"verdict*\", \"null*\", \"leak*\", \"lookahead\", \"look ahead\", \"audit*\", \"held out\", \"holdout*\", \"gate*\",\n        \"falsif*\", \"false kill*\", \"re verif*\", \"integrity\", \"freeze\", \"oos\", \"out of sample\", \"in sample\",\n        \"walk forward\", \"robustness\", \"significance\", \"reality check\", \"kill test\", \"kill check\", \"pbo\",\n        \"permutation\", \"placebo\", \"snoop*\", \"survivorship\", \"p hack*\"\n      ]\n    },\n    \"final_pack\": {\n      \"model\": \"opus\", \"effort\": \"high\", \"mode\": \"enforce\",\n      \"keywords\": [\n        \"final send pack\", \"send pack*\", \"final pack\", \"final resume*\", \"resume tailor*\", \"tailor* resume*\", \"build resume*\",\n        \"final cover letter\"\n      ]\n    },\n    \"drafts\": {\n      \"model\": \"sonnet\", \"effort\": \"medium\", \"mode\": \"suggest\",\n      \"keywords\": [\n        \"draft*\", \"outreach\", \"copy\", \"copywrit*\", \"seo\", \"claims\", \"youtube\", \"video script*\", \"script for\",\n        \"cold email*\", \"email*\", \"cover letter*\", \"blog*\", \"linkedin\", \"post\", \"posts\", \"caption*\", \"thumbnail text\"\n      ]\n    },\n    \"spec_code\": {\n      \"model\": \"opus\", \"effort\": \"high\", \"mode\": \"enforce\",\n      \"keywords\": [\n        \"per prereg\", \"per spec\", \"from spec\", \"to spec\", \"frozen spec\", \"per the spec\", \"spec synthesis\",\n        \"synthesi* spec*\", \"frozen prereg\", \"build*\", \"engine*\", \"write\", \"implement*\", \"refactor*\", \"scaffold*\", \"repaint*\", \"parity\", \"port to\"\n      ]\n    },\n    \"checked_fix\": {\n      \"model\": \"sonnet\", \"effort\": \"medium\", \"mode\": \"checked\",\n      \"keywords\": [\n        \"fix*\", \"hotfix*\", \"bug*\", \"debug*\", \"repair*\", \"add\", \"broken\", \"crash*\", \"test failure*\", \"failing test*\",\n        \"compile*\", \"compiler error*\", \"address review*\", \"address feedback\", \"address comments\"\n      ]\n    },\n    \"review\": {\n      \"model\": \"opus\", \"effort\": \"high\", \"mode\": \"enforce\",\n      \"keywords\": [\"review*\", \"fresh context\", \"second look\", \"critique*\", \"sanity check*\"]\n    },\n    \"run_report\": {\n      \"model\": \"inherit\", \"mode\": \"enforce\",\n      \"keywords\": [\n        \"run\", \"runs\", \"rerun*\", \"re run*\", \"execute\", \"report\", \"plot*\", \"chart*\", \"cross check*\", \"fresh*\", \"stale*\",\n        \"pipeline*\", \"status\", \"smoke test*\", \"benchmark*\", \"measure*\", \"monitor*\", \"health check*\", \"backtest*\"\n      ]\n    },\n    \"extract\": {\n      \"model\": \"sonnet\", \"effort\": \"low\", \"mode\": \"suggest\",\n      \"keywords\": [\n        \"extract*\", \"mine\", \"mining\", \"summar*\", \"transcript*\", \"per item\", \"fields\", \"facts\", \"tag*\",\n        \"classify each\", \"label each\", \"digest\", \"scrape*\", \"pull out\"\n      ]\n    },\n    \"mech_edit\": {\n      \"model\": \"sonnet\", \"effort\": \"low\", \"mode\": \"checked\",\n      \"keywords\": [\n        \"merge*\", \"push\", \"install*\", \"apply\", \"config*\", \"bump*\", \"commit*\", \"mechanical\", \"rebase\", \"cherry pick*\",\n        \"uninstall*\", \"symlink*\", \"renam*\", \"move files\", \"format*\", \"update*\", \"readme*\", \"changelog*\"\n      ]\n    },\n    \"locate\": {\n      \"model\": \"haiku\", \"mode\": \"suggest\",\n      \"keywords\": [\n        \"locate\", \"map\", \"maps\", \"grep\", \"search*\", \"scan*\", \"inventor*\", \"catalog*\", \"survey*\", \"explore\", \"look up\", \"lookup\",\n        \"directory map*\", \"dir map*\", \"folder map*\", \"list files\", \"where is\", \"where are\"\n      ]\n    },\n    \"unclassified\": {\n      \"model\": \"inherit\", \"mode\": \"suggest\",\n      \"keywords\": [\n        \"vet\", \"vets\", \"vetting\", \"vetted\", \"quality test*\", \"find\", \"finds\", \"evaluat*\", \"assess*\", \"investigat*\", \"diagnos*\",\n        \"root cause*\", \"deep dive*\", \"research*\", \"why\"\n      ]\n    }\n  },\n  \"agent_map\": {\n    \"frugal:scout\": \"locate\",\n    \"frugal:extractor\": \"extract\",\n    \"delegate:reviewer\": \"review\"\n  },\n  \"agent_fallback\": {\n    \"delegate:builder\": \"spec_code\"\n  }\n}\n"

export const LABELS_DEV: { id: number; description: string; subagent_type: string; label: string }[] = [
 {
  "id": 0,
  "description": "London noise-mom train gauntlet",
  "subagent_type": "general-purpose",
  "label": "verdict"
 },
 {
  "id": 3,
  "description": "Merge retune into master and install",
  "subagent_type": "delegate:mechanic",
  "label": "mech_edit"
 },
 {
  "id": 5,
  "description": "Inventory part 3 (unified/fabio/xasset)",
  "subagent_type": "delegate:mechanic",
  "label": "locate"
 },
 {
  "id": 7,
  "description": "Build M2 STDV-to-TDO backtest per prereg",
  "subagent_type": "delegate:builder",
  "label": "spec_code"
 },
 {
  "id": 9,
  "description": "Inventory propfarm v49+ and subprojects",
  "subagent_type": "frugal:scout",
  "label": "locate"
 },
 {
  "id": 11,
  "description": "Build mod 19 cost-band",
  "subagent_type": "delegate:builder",
  "label": "spec_code"
 },
 {
  "id": 14,
  "description": "Fresh-context review of 03-ladder-dxf",
  "subagent_type": "delegate:reviewer",
  "label": "review"
 },
 {
  "id": 16,
  "description": "Inventory part 2 (James/SCRIV)",
  "subagent_type": "delegate:mechanic",
  "label": "locate"
 },
 {
  "id": 18,
  "description": "Socrates extract S1",
  "subagent_type": "frugal:extractor",
  "label": "extract"
 },
 {
  "id": 20,
  "description": "Inventory part 1b (propfarm v21-v54)",
  "subagent_type": "delegate:mechanic",
  "label": "locate"
 },
 {
  "id": 23,
  "description": "Build mod 13 holdout-vault",
  "subagent_type": "delegate:builder",
  "label": "spec_code"
 },
 {
  "id": 25,
  "description": "Data integrity audit",
  "subagent_type": "general-purpose",
  "label": "verdict"
 },
 {
  "id": 27,
  "description": "Build v54 forward runner",
  "subagent_type": "delegate:builder",
  "label": "spec_code"
 },
 {
  "id": 29,
  "description": "Rerun MIM on new data",
  "subagent_type": "delegate:builder",
  "label": "run_report"
 },
 {
  "id": 31,
  "description": "Fix 2 test failures, gates, commit",
  "subagent_type": "delegate:builder-lite",
  "label": "checked_fix"
 },
 {
  "id": 33,
  "description": "Extract James trades batch 2",
  "subagent_type": "general-purpose",
  "label": "extract"
 },
 {
  "id": 35,
  "description": "Verdict schema v2 Python side",
  "subagent_type": "delegate:builder",
  "label": "spec_code"
 },
 {
  "id": 37,
  "description": "Extract James trades batch 1",
  "subagent_type": "general-purpose",
  "label": "extract"
 },
 {
  "id": 39,
  "description": "Mine stops/targets/trims",
  "subagent_type": "Explore",
  "label": "extract"
 },
 {
  "id": 41,
  "description": "Build FREE_TOOLS.md tool map",
  "subagent_type": "delegate:builder-lite",
  "label": "unclassified"
 },
 {
  "id": 43,
  "description": "Extract BIMCraft maturity facts",
  "subagent_type": "frugal:extractor",
  "label": "extract"
 },
 {
  "id": 45,
  "description": "Mine veto/stay-cash rules",
  "subagent_type": "Explore",
  "label": "extract"
 },
 {
  "id": 47,
  "description": "Re-verify 4b fixes before freeze",
  "subagent_type": "general-purpose",
  "label": "verdict"
 },
 {
  "id": 49,
  "description": "Refute the v13 tier result",
  "subagent_type": "general-purpose",
  "label": "verdict"
 },
 {
  "id": 51,
  "description": "Mine 3 live-trade transcripts",
  "subagent_type": "general-purpose",
  "label": "extract"
 },
 {
  "id": 53,
  "description": "Audit data pipeline freshness",
  "subagent_type": "general-purpose",
  "label": "run_report"
 },
 {
  "id": 55,
  "description": "ngspice cross-check and plots",
  "subagent_type": "delegate:builder-lite",
  "label": "run_report"
 },
 {
  "id": 57,
  "description": "Summarize 2 video transcripts",
  "subagent_type": "frugal:extractor",
  "label": "extract"
 },
 {
  "id": 1,
  "description": "Intra-night drift gauntlet NQ",
  "subagent_type": "general-purpose",
  "label": "verdict"
 },
 {
  "id": 4,
  "description": "Fix P1 compile, write README",
  "subagent_type": "frugal:mechanic",
  "label": "checked_fix"
 },
 {
  "id": 6,
  "description": "Fix fadj seam in equivalence, re-run A1",
  "subagent_type": "delegate:builder",
  "label": "checked_fix"
 },
 {
  "id": 8,
  "description": "Socrates priced trades S4",
  "subagent_type": "frugal:extractor",
  "label": "extract"
 },
 {
  "id": 10,
  "description": "Inventory part 1 (propfarm)",
  "subagent_type": "delegate:mechanic",
  "label": "locate"
 },
 {
  "id": 13,
  "description": "Fix R1 pin-number overlap",
  "subagent_type": "frugal:mechanic",
  "label": "checked_fix"
 },
 {
  "id": 15,
  "description": "Map launchd forward jobs",
  "subagent_type": "frugal:scout",
  "label": "locate"
 },
 {
  "id": 17,
  "description": "Apply 3 doc edits, test, commit",
  "subagent_type": "delegate:mechanic",
  "label": "mech_edit"
 },
 {
  "id": 19,
  "description": "Socrates level+volume test",
  "subagent_type": "delegate:builder",
  "label": "verdict"
 },
 {
  "id": 22,
  "description": "Semiconductor, telecom, data center firms",
  "subagent_type": "delegate:mechanic",
  "label": "unclassified"
 },
 {
  "id": 24,
  "description": "Map AutoRank outreach state",
  "subagent_type": "frugal:scout",
  "label": "locate"
 },
 {
  "id": 26,
  "description": "Scan Drive for resume gaps",
  "subagent_type": "delegate:builder-lite",
  "label": "locate"
 },
 {
  "id": 28,
  "description": "Extract remaining tasks for competition + mods",
  "subagent_type": "frugal:extractor",
  "label": "extract"
 },
 {
  "id": 30,
  "description": "Extract James trades batch 3b",
  "subagent_type": "general-purpose",
  "label": "extract"
 },
 {
  "id": 32,
  "description": "Fix call-log integrity findings",
  "subagent_type": "delegate:builder",
  "label": "checked_fix"
 },
 {
  "id": 34,
  "description": "Prop rules: Tradeify+TPT",
  "subagent_type": "delegate:mechanic",
  "label": "unclassified"
 },
 {
  "id": 36,
  "description": "Skeptic: 10k study leaks/data",
  "subagent_type": "general-purpose",
  "label": "verdict"
 },
 {
  "id": 38,
  "description": "Push project 03 commits to GitHub",
  "subagent_type": "delegate:runner",
  "label": "mech_edit"
 },
 {
  "id": 40,
  "description": "Adversarial audit of ORB-PB runner",
  "subagent_type": "general-purpose",
  "label": "verdict"
 },
 {
  "id": 42,
  "description": "Inventory mnq-mgc-research and ORB repos",
  "subagent_type": "frugal:scout",
  "label": "locate"
 },
 {
  "id": 44,
  "description": "Add VIN sense to KiCad schematic",
  "subagent_type": "frugal:builder",
  "label": "checked_fix"
 },
 {
  "id": 46,
  "description": "Skeptic: prop option sim",
  "subagent_type": "delegate:reviewer",
  "label": "verdict"
 },
 {
  "id": 48,
  "description": "Skeptic review of policy_sim.py",
  "subagent_type": "general-purpose",
  "label": "verdict"
 },
 {
  "id": 50,
  "description": "Write ladder-dxf v0 files and run gates",
  "subagent_type": "delegate:builder-lite",
  "label": "spec_code"
 },
 {
  "id": 52,
  "description": "Skeptic audit of v4 code",
  "subagent_type": "general-purpose",
  "label": "verdict"
 },
 {
  "id": 54,
  "description": "Drive scan second pass",
  "subagent_type": "delegate:builder-lite",
  "label": "locate"
 },
 {
  "id": 56,
  "description": "Independent re-run of ladder-dxf gates",
  "subagent_type": "delegate:runner",
  "label": "run_report"
 },
 {
  "id": 59,
  "description": "Overfit and inference audit",
  "subagent_type": "general-purpose",
  "label": "verdict"
 },
 {
  "id": 200,
  "description": "Build M4a backtest per frozen prereg",
  "subagent_type": "delegate:builder",
  "label": "spec_code"
 },
 {
  "id": 201,
  "description": "Skeptic leak audit of v3 legs",
  "subagent_type": "general-purpose",
  "label": "verdict"
 },
 {
  "id": 202,
  "description": "Lookahead leak audit",
  "subagent_type": "general-purpose",
  "label": "verdict"
 },
 {
  "id": 203,
  "description": "Vet repos batch A",
  "subagent_type": "frugal:scout",
  "label": "unclassified"
 },
 {
  "id": 204,
  "description": "Update project 1 README",
  "subagent_type": "delegate:builder-lite",
  "label": "mech_edit"
 },
 {
  "id": 205,
  "description": "KiCad schematic for sync buck",
  "subagent_type": "frugal:builder",
  "label": "unclassified"
 },
 {
  "id": 206,
  "description": "Build ops dashboard",
  "subagent_type": "general-purpose",
  "label": "spec_code"
 },
 {
  "id": 207,
  "description": "Gate run, held-out once, commit",
  "subagent_type": "delegate:mechanic",
  "label": "verdict"
 },
 {
  "id": 208,
  "description": "Inventory part 4b (remaining)",
  "subagent_type": "delegate:mechanic",
  "label": "locate"
 },
 {
  "id": 209,
  "description": "License check reference repos",
  "subagent_type": "frugal:scout",
  "label": "locate"
 },
 {
  "id": 210,
  "description": "Rerun MNQ NY ORB on new data",
  "subagent_type": "delegate:builder",
  "label": "run_report"
 },
 {
  "id": 211,
  "description": "Vet repos batch B",
  "subagent_type": "frugal:scout",
  "label": "unclassified"
 },
 {
  "id": 212,
  "description": "Deep-dive maybes and GLM/Freebuff",
  "subagent_type": "fable-baton:scout",
  "label": "unclassified"
 },
 {
  "id": 213,
  "description": "Inventory part 1c (prop_farm)",
  "subagent_type": "delegate:mechanic",
  "label": "locate"
 },
 {
  "id": 214,
  "description": "Socrates extract S0",
  "subagent_type": "frugal:extractor",
  "label": "extract"
 },
 {
  "id": 215,
  "description": "Mine entry types",
  "subagent_type": "Explore",
  "label": "extract"
 },
 {
  "id": 216,
  "description": "Inventory part 2c (Socrates/lilfish)",
  "subagent_type": "delegate:mechanic",
  "label": "locate"
 },
 {
  "id": 217,
  "description": "Apply Codex review fixes",
  "subagent_type": "general-purpose",
  "label": "checked_fix"
 },
 {
  "id": 218,
  "description": "Round 2: naming, chains, dedupe fixes",
  "subagent_type": "delegate:builder-lite",
  "label": "checked_fix"
 },
 {
  "id": 219,
  "description": "Find LSE quota burn + missed job",
  "subagent_type": "frugal:scout",
  "label": "unclassified"
 },
 {
  "id": 220,
  "description": "Fresh review of effort-router v2",
  "subagent_type": "delegate:reviewer",
  "label": "review"
 },
 {
  "id": 221,
  "description": "Quality-test the brief prompt",
  "subagent_type": "frugal:extractor",
  "label": "unclassified"
 },
 {
  "id": 222,
  "description": "Build meta-labeling test per frozen prereg",
  "subagent_type": "delegate:builder",
  "label": "spec_code"
 },
 {
  "id": 223,
  "description": "Extract 9 mods from PDF",
  "subagent_type": "frugal:extractor",
  "label": "extract"
 },
 {
  "id": 224,
  "description": "Socrates extract V1",
  "subagent_type": "frugal:extractor",
  "label": "extract"
 },
 {
  "id": 225,
  "description": "Inventory part 4 (ORB/MGC/indicators)",
  "subagent_type": "delegate:mechanic",
  "label": "locate"
 },
 {
  "id": 226,
  "description": "Skeptic: live_run/rdata/fetch changes",
  "subagent_type": "general-purpose",
  "label": "verdict"
 },
 {
  "id": 227,
  "description": "curve18 engine remainder + run script",
  "subagent_type": "delegate:builder",
  "label": "spec_code"
 },
 {
  "id": 228,
  "description": "Skeptic: MTJ-1 false-kill hunt",
  "subagent_type": "general-purpose",
  "label": "verdict"
 },
 {
  "id": 229,
  "description": "Research repos batch A",
  "subagent_type": "fable-baton:scout",
  "label": "unclassified"
 },
 {
  "id": 230,
  "description": "Medical, embedded, test lab companies",
  "subagent_type": "delegate:mechanic",
  "label": "unclassified"
 },
 {
  "id": 231,
  "description": "Build curve18 panel + engine + tests",
  "subagent_type": "delegate:builder",
  "label": "spec_code"
 },
 {
  "id": 232,
  "description": "Socrates extract V0",
  "subagent_type": "frugal:extractor",
  "label": "extract"
 },
 {
  "id": 233,
  "description": "Prop rules: Topstep+Apex",
  "subagent_type": "delegate:mechanic",
  "label": "unclassified"
 },
 {
  "id": 234,
  "description": "Macro announcement gauntlet NQ",
  "subagent_type": "general-purpose",
  "label": "verdict"
 },
 {
  "id": 235,
  "description": "Skeptic: noise-mom new-data rerun",
  "subagent_type": "delegate:reviewer",
  "label": "verdict"
 },
 {
  "id": 236,
  "description": "Skeptic: rsim per-exit MAE",
  "subagent_type": "general-purpose",
  "label": "verdict"
 },
 {
  "id": 237,
  "description": "Vet install candidates",
  "subagent_type": "fable-baton:scout",
  "label": "unclassified"
 },
 {
  "id": 238,
  "description": "Utilities, renewables, process controls firms",
  "subagent_type": "delegate:mechanic",
  "label": "unclassified"
 },
 {
  "id": 239,
  "description": "Map call-sheet data sources",
  "subagent_type": "frugal:scout",
  "label": "locate"
 }
]
