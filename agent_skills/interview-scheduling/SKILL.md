---
name: interview-scheduling
description: Use when inviting a resume-library candidate to interview through the candidate source platform account.
---

# 约面试自动化

## 目标

从简历库对候选人发起约面试沟通。系统必须回到候选人简历来源的平台账号，按平台候选人 ID 搜索并核对同一人，然后发送固定消息：

`加我微信沟通，carhhxh`

## 强制规则

- 必须使用 `platformCandidateId` 搜索候选人，不能用简历姓名、平台昵称、手机号或文件名兜底。
- 搜索完成后必须核对当前结果/详情页/会话页中的平台 ID 与目标 ID 一致。
- ID 不一致、缺少 ID、搜索不到、账号未登录、人机验证、页面异常时立即停止并返回原因。
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
- `platformCandidateId`: 平台候选人 ID
- `message`: 固定为 `加我微信沟通，carhhxh`
- `dryRun`: 只搜索、核对、点开联系人和定位输入框，不发送

## 三平台流程

1. 打开对应账号当前招聘平台会话页。
2. 在联系人/人才搜索栏输入 `platformCandidateId`。
3. 等待搜索结果出现，读取结果 ID 或详情页 ID。
4. ID 一致后点开联系人。
5. 再次确认当前会话是目标候选人。
6. 填入固定消息。
7. 点击发送。
8. 校验最近我方消息已出现固定话术。

## 失败原因

- `missing_platform_candidate_id`: 简历缺少平台候选人 ID。
- `search_input_not_found`: 当前平台页没有找到可用搜索栏。
- `candidate_id_not_verified`: 搜索后无法核对平台 ID 一致。
- `chat_input_not_found`: 已找到候选人但没有找到单聊输入框。
- `send_verification_failed`: 点击发送后没有校验到消息。
- `captcha_or_login_required`: 页面要求登录、人机验证或账号异常。
