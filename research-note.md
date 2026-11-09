# Harnesses constrain behaviour, not memory: managing requirements in agentic software development

AI models continue to improve on well-specified tasks; in October 2026, OpenAI released more than 700 manuscripts on open mathematical problems produced by one of its models (OpenAI, 2026). Everyday software development has changed less. Across 806 open-source projects, adopting Cursor produced a "large, but transient increase" in development velocity alongside a "persistent increase in static analysis warnings and code complexity" (He et al., 2026). This note argues that a central cause is unmanaged memory of intent. Current harnesses constrain what agents do, but not what they remember about requirements, and good agentic practice must manage both.

Two problems are often treated as one. The first is attention drift within a long context: performance "significantly degrades when models must access relevant information in the middle of long contexts" (Liu et al., 2024). The second is memory confusion, in which an agent recalls everything it has been told, including requirements that are no longer valid. When a product manager revises a request, a human programmer usually knows which requirements remain valid and which have been withdrawn. Naur (1985) described such knowledge as part of the programmer's theory of the program, which "could not conceivably be expressed" (p. 400). An agent has only what has been written, and changes in intent are recorded asymmetrically: new requirements are stated explicitly, whereas withdrawn ones are usually no longer mentioned. Consider a team that replaces email login with Google sign-in during a conversation without updating the plan. A later session may read both and attempt to satisfy both. More context does not resolve this and may worsen it, because more outdated material is retained. Vendor guidance addresses the first problem: Claude Code's documentation recommends short memory files because "Longer files consume more context and reduce adherence" (Anthropic, n.d.). This concerns the size of memory, not whether its contents remain valid.

Memory confusion also compounds under automation. Each autonomous run builds on the artefacts of the previous one, so a stale requirement becomes code, and that code becomes evidence of intent for the next session. On SlopCodeBench, "agents pass checkpoints while producing code that erodes and bloats with each turn", and "explicit quality guidance reduces initial verbosity and erosion by up to a third, without affecting degradation rates" (Orlanski et al., 2026). Instructions written once change the starting point, not the rate of drift.

Current harnesses do not address this and may aggravate it. Böckeler (2026) describes a harness as guides that steer the agent and sensors that check its output, both derived from what has been written down. If the plan still specifies email login, a well-designed harness retains the corresponding tests and pushes the agent to satisfy them, enforcing a requirement that is no longer valid. Harnesses could instead support memory management. They can steer agents towards small, loosely coupled functions, following Parnas's (1972) principle of hiding each design decision likely to change within one module, so that code for a withdrawn requirement can be deleted cleanly. They can also flag tests and instructions tied to withdrawn requirements for removal. Even OpenSpec, which records each change, leaves the decisive step to a person: "Your AI writes these; you review the plan before any code is written" (Fission AI, n.d.). A tool can record that a requirement has been withdrawn, but deciding to withdraw it is a product decision. Storey (2026) calls the resulting gap intent debt.

That decision falls to programmers, whose role is shifting from writing code towards a hybrid of product management and engineering in which humans "orchestrate and mentor agent teams" (Hassan et al., 2026). Brooks (1986) argued that "the hardest single part of building a software system is deciding precisely what to build" (p. 14). The new role therefore depends on requirements engineering, software design and project management. Agentic tools do not supply these skills, and they are unevenly distributed; Osmani (2026) notes that "agentic engineering disproportionately benefits senior engineers". Developers may stop writing code, but they cannot delegate the requirements or the architecture.

The strongest objection concerns cost. Maintaining a plan takes time, the plan may itself drift, and requirements are often discovered only through building; Gonzalez (2026) argues that "a sufficiently detailed spec is code". The objection is partly correct, so the plan should be revised after each run rather than perfected in advance. Memory management, however, does not require greater detail. Marking a requirement as withdrawn takes a single line, whereas hours of autonomous work built on it are wasted. A second objection is that models will learn to ask clarifying questions, yet in a 2024 benchmark most responses from code models "still generate code rather than ask questions" (Wu & Fard, 2025). More fundamentally, a model can only ask about conflicts it can detect, and a requirement withdrawn in a person's mind but not in the text still appears valid.

Good agentic practice, on this account, manages the agent's memory as well as its behaviour. During a phase of work, each requirement carries an explicit status (active, revised, retained or withdrawn), the plan is revised before the code when direction changes, and long runs are checked against the current plan. Status marking has a limit, however. Agent memory in current tools is largely append-only: a correction is stored beside what it corrects, so marking a requirement as withdrawn is itself one more item to remember. Instruction files are also rarely revised, since "40.4% of the analyzed files have only one recorded modification event" (Shanto et al., 2026). Pruning is feasible: Anthropic "removed over 80% of Claude Code's system prompt for its latest models with no measurable loss" (Thoughtworks, 2026). At the end of each major phase, once the software has been verified, people should therefore delete withdrawn requirements, obsolete tests and outdated instructions rather than leave the agent to manage its own memory. This overhead is justified for work that spans several sessions or contributors, and it makes requirements and design skills a core part of agentic engineering.

## References

Anthropic. (n.d.). *Memory* [Claude Code documentation]. Retrieved November 9, 2026, from https://code.claude.com/docs/en/memory

Böckeler, B. (2026, April 2). *Harness engineering for coding agent users*. martinfowler.com. https://martinfowler.com/articles/harness-engineering.html

Brooks, F. P., Jr. (1986). *No silver bullet: Essence and accidents of software engineering* (Technical Report TR86-020). University of North Carolina at Chapel Hill. https://www.cs.unc.edu/techreports/86-020.pdf

Fission AI. (n.d.). *OpenSpec* [Computer software]. GitHub. Retrieved November 9, 2026, from https://github.com/Fission-AI/OpenSpec

Gonzalez, G. (2026, March 17). *A sufficiently detailed spec is code*. Haskell for all. https://haskellforall.com/2026/03/a-sufficiently-detailed-spec-is-code

Hassan, A. E., Li, H., Lin, D., Adams, B., Chen, T.-H., Kashiwa, Y., & Qiu, D. (2026). Agentic software engineering: Foundational pillars and a research roadmap. *ACM Transactions on Software Engineering and Methodology*. https://doi.org/10.1145/3861334

He, H., Miller, C., Agarwal, S., Kästner, C., & Vasilescu, B. (2026). Speed at the cost of quality: How Cursor AI increases short-term velocity and long-term complexity in open-source projects. In *Proceedings of MSR '26*. https://doi.org/10.1145/3793302.3793349

Liu, N. F., Lin, K., Hewitt, J., Paranjape, A., Bevilacqua, M., Petroni, F., & Liang, P. (2024). Lost in the middle: How language models use long contexts. *Transactions of the Association for Computational Linguistics*. https://arxiv.org/abs/2307.03172

Naur, P. (1985). Programming as theory building. *Microprocessing and Microprogramming, 15*(5), 253–261. https://doi.org/10.1016/0165-6074(85)90032-8 (page numbers from the reprint in Cockburn, A. (2007). *Agile software development: The cooperative game* (2nd ed.), Appendix B)

OpenAI. (2026). *math* [Data set]. GitHub. https://github.com/openai/math

Orlanski, G., Roy, D., Yun, A., Shin, C., Gu, A., Ge, A., Adila, D., Roberts, N., Sala, F., & Albarghouthi, A. (2026). *SlopCodeBench: Benchmarking how coding agents degrade over long-horizon iterative tasks* (arXiv:2603.24755). https://arxiv.org/abs/2603.24755

Osmani, A. (2026, February 4). *Agentic engineering*. https://addyosmani.com/blog/agentic-engineering/

Parnas, D. L. (1972). On the criteria to be used in decomposing systems into modules. *Communications of the ACM, 15*(12), 1053–1058. https://doi.org/10.1145/361598.361623

Shanto, M. H., Islam, M. A., Asaduzzaman, M., & Ngom, A. (2026). *Toward an evidence-based template for agent instruction files: An empirical study of adoption, consistency, and maintenance* (arXiv:2611.02383). https://arxiv.org/abs/2611.02383

Storey, M.-A. (2026). *From technical debt to cognitive and intent debt: Rethinking software health in the age of AI* (arXiv:2603.22106). https://arxiv.org/abs/2603.22106

Thoughtworks. (2026, November 4). *Technology Radar* (Vol. 35). https://www.thoughtworks.com/content/dam/thoughtworks/documents/radar/2026/11/tr_technology_radar_vol_35_en.pdf

Wu, J. J. W., & Fard, F. H. (2025). HumanEvalComm: Benchmarking the communication competence of code generation for LLMs and LLM agent. *ACM Transactions on Software Engineering and Methodology*. https://arxiv.org/abs/2406.00215
