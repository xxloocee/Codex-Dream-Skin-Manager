# 代码规则

- 默认不要写测试文件，不要跑测试，不要进行可视化验证，等一个功能块完整写完，得到明确指示再去写测试文件并测试

<!-- CATPAW:BEGIN -->
# CatPaw Protocol

- This project uses the installed runtime at `~/.catpaw/`; read `~/.catpaw/runtime-policy.md` before routed work.
- The project-local `.catpaw/` native graph contains only Index, Milestone, Work Item, Plan, and Evidence; migration may retain a graph-external legacy archive.
- Select `Direct`, `Tracked`, or `Gated`, then follow `Think -> Plan -> Build -> Review -> Test -> Ship -> Reflect`.
- Reuse an active Milestone for authorized multi-Work progress; update artifacts and tell the user verification plus `Next` after each meaningful unit.
- Proactively use current-tool subagents for triggered Independent Checks. CatPaw external Agent routing is reciprocal `cc`/`cx` only.
- Do not copy runtime files into this project. Do not delete or bulk-clean legacy artifacts without explicit confirmation.
- No Lens, Agent, Evidence, CLI, hook, or method authorizes commit, push, PR, deploy, destructive actions, or secret access.
<!-- CATPAW:END -->
