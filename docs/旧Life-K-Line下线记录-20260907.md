# 旧人生 K 线下线记录

## 身份核对

- 旧站点：`https://leslie-wylie-github-io.vercel.app/`，页面标题为“人生K线 | 八字命理可视化”。
- Vercel项目：`leslie-wylie-github-io`，ID `prj_7UYA9DS0s6JtJ9SBsomwr9vNUxIV`。
- Vercel Git绑定：`LeslieWylie/LeslieWylie.github.io`，源码README对应人生K线。
- 该仓库 `api/log.ts` 使用 `usage_logs`；活教参代码和迁移中无此表引用。
- 共用的Supabase项目不能删除：其包含活教参正在使用的数据。项目显示名称已从Life_k_line改为“活教参”，项目ID不变。

## 已执行

1. 完整镜像备份旧仓库，git fsck通过，HEAD为 `d1097619c4bc2f25b302118d8ddd5ade255f758f`。
2. 备份旧Vercel项目元数据，然后删除上述明确指定的旧Vercel项目。
3. GitHub仓库设为归档，不永久删除源码。
4. 将旧表 `public.usage_logs` 移入 `retired_life_k_line` 私有归档schema，保留58条记录作恢复备份。匿名和登录用户均没有该schema的USAGE权限。

本地备份位于 `/Users/mlamp/.local/share/project-retirement/life-k-line-20260907/`，使用限制访问权限保存；可能包含历史配置，不提交仓库或公开分发。备份用于恢复参考，不承诺能恢复已删除的原Vercel部署ID或所有受保护环境变量。

## 读回验证

- 旧站点：HTTP404，已下线。
- GitHub：isArchived=true。
- public.usage_logs已不存在；归档表记录数58；anon/authenticated均无法使用归档schema。
- 活教参固定地址HTTP200，指定生产回归草稿仍存在。未改动活教参草稿、密钥和私人教材权限表。

本次采取“删除旧部署、归档源码与旧数据”，并非永久销毁全部备份；未扩大到其他仓库、其他部署地址、旧账号或本地工作目录。
