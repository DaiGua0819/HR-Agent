---
name: interview-scheduling
description: Use when inviting a resume-library candidate to interview through the candidate source platform account.
---

# 约面试自动化

## 目标

从简历库对候选人发起约面试沟通。系统必须回到候选人简历来源的平台账号，按当时聊天联系人使用的平台显示名搜索，再用岗位和少量聊天证据确认是同一个联系人，然后发送固定消息：

`加我微信沟通，carhhxh`

## 强制规则

- 必须使用 `platformContact.displayName` 搜索候选人，不能使用简历姓名、手机号、文件名、URL 或平台候选人 ID 兜底。
- 搜索完成后必须结合 `platformContact.chatEvidence`、`platformContact.appliedPosition`、来源平台和账号核对当前联系人。
- 搜索不到、同名多人无法用证据确认、缺少平台联系人名、账号未登录、人机验证、页面异常时立即停止并返回原因。
- 发送前必须确认已经打开目标候选人的单聊输入框。
- 发送后必须校验最近我方消息包含固定话术；校验不到则返回失败。
- 同一候选人已经发送过约面试消息时默认不重复发送。

## Function Call 设计

- 前端入口：简历库候选人行的“约面试”按钮。
- 后端入口：`POST /api/resumes/:id/interview-invite`。
- Agent 入口：`POST /api/interview-invite`，支持 `dryRun`。

请求核心字段：

- `platform`: `boss` / `51job` / `zhilian`
- `sourceKey`: `boss_a` / `boss_b` / `job51_a` / `job51_b` / `zhilian_a` / `zhilian_b`
- `platformContact.displayName`: 平台联系人当前使用的显示名
- `platformContact.label`: 当时联系人列表整行文本
- `platformContact.appliedPosition`: 当时沟通岗位
- `platformContact.chatEvidence`: 最近 3 条有效聊天片段
- `message`: 固定为 `加我微信沟通，carhhxh`
- `dryRun`: 只搜索、核对、点开联系人和定位输入框，不发送

## 三平台流程

1. 打开对应账号当前招聘平台会话页。
2. 在联系人/人才搜索栏输入 `platformContact.displayName`。
3. 等待搜索结果出现。
4. 若存在多个同名联系人，必须用岗位或聊天证据确认；不能确认则停止。
5. 点开确认后的联系人。
6. 再次确认当前会话是目标候选人。
7. 填入固定消息。
8. 点击发送。
9. 校验最近我方消息已出现固定话术。

## 失败原因

- `missing_platform_display_name`: 简历缺少平台联系人显示名。
- `search_input_not_found`: 当前平台页没有找到可用搜索栏。
- `search_result_not_found`: 搜索后未找到可确认的目标联系人。
- `multiple_candidates_unverified`: 同名候选人过多，无法用岗位或聊天证据确认。
- `chat_evidence_not_matched`: 未能匹配岗位或聊天证据。
- `chat_input_not_found`: 已找到候选人但没有找到单聊输入框。
- `send_verification_failed`: 点击发送后没有校验到消息。
- `captcha_or_login_required`: 页面要求登录、人机验证或账号异常。
