# 51job platform map

Last checked: 2026-05-29

Scope: read-only discovery for adding 51job automation. During this pass, do not send messages, do not click "立即Hi聊", and do not click greeting/send controls.

## Browser/session

- Browser: project CloakBrowser, not normal Google Chrome.
- CDP port: `9224`
- Profile: `cdp-browser-profile-51job`
- Recommend page: `https://ehire.51job.com/Revision/talent/search-recommend...`, title `人才望远镜`
- Chat page: `https://ehire.51job.com/Revision/chat...`, title `人才沟通`

## Reuse target

Keep BOSS business logic and split platform operations behind an adapter.

Reusable BOSS-side logic/function calls:

- Function-call dispatch: `agent_web_server.py` around `2198`
- `extract_chat_messages`: around `2672`
- `read_chat_context`: around `2820`
- `send_recruiter_common_phrase`: around `3314`
- `screen_recruiter_position_rules`: around `3959`
- `screen_all_recruiter_unread_basic_conditions`: around `4927`
- `proactive_contact_recommended_candidates`: around `5729`
- `request_resume_from_recruiter_conversation`: around `6565`

Recommended adapter methods:

- `open_recommend_page()`
- `open_chat_page()`
- `select_position(target_position)`
- `collect_recommend_candidate_cards()`
- `open_candidate_detail(card)`; read-only detail open only, no greeting
- `extract_candidate_profile()`
- `is_already_contacted()`
- `click_greet()`; only called after business rules pass
- `prepare_unread_filter()`
- `collect_chat_threads()`
- `open_chat_thread(thread)`
- `extract_chat_messages()`
- `send_message(text)`
- `request_resume_if_needed()`

## 51job left navigation

Stable IDs:

- `#sensor_recommand_menu`: 人才望远镜, visible around `x=4,y=240,w=192,h=48`
- `#sensor_talentsearch_menu`: 人才搜索, visible around `x=4,y=296,w=192,h=48`
- `#sensor_talentcommunicate`: 人才沟通, visible around `x=4,y=352,w=192,h=48`
- `#sensor_homepage_positionmanagement`: 职位管理, visible around `x=4,y=128,w=192,h=48`

## 人才望远镜

Current active page selectors:

- Main container: `.main_container.eh-talent-search`
- Position tab container: `.eh-position.clearfix`
- Position tab: `div.menu-item`
- Active position tab: `div.menu-item.is-active`
- Position text: `.job_name_text`
- Add position: menu item text `添加关注职位`
- Quick filter area: `.recommend_quick_filter`
- Advanced filter: `#talent_recommend_advance_filter`, text `高级筛选 · 2`
- Common blockers on this page should be closed before continuing: driver guide `#driver-popover-item`, AI/recommendation popovers, WeChat/email notification cards, and any visible close-only controls whose text is `不感兴趣` / `跳过` / `稍后再说` / `知道了` / `我知道了` / `关闭`.

Visible position examples at latest check:

- `膨润土销售人员` active
- `国际业务管培生`
- `电气工程师`
- `应用技术经理（工业涂料领域）`
- `AI应用开发实习生`
- `化学实验员 已结束`
- `砂粉销售经理 已结束`
- `建材/建涂销售经理 已结束`
- `设备机修工 已结束`
- `后端开发工程师 已结束`
- `前端开发工程师 已结束`

Candidate card:

- Card wrapper: `div.item.resume-card`
- Inner card: `.el-card.is-hover-shadow`
- Body: `.el-card__body`
- Content root: `.card`
- Visible card content section: `.card > section.e`
- First visible card roughly starts at `x=225,y=196,w=1279,h=192`
- Candidate text includes: intention city/job/salary, name, activity status, age, experience, education, location, work history, school history, tags.

Greeting button:

- Button selector: `button.el-button.tm_button.el-button--primary`
- Wrapper: `div.userbutton`
- Text: `立即Hi聊`
- First visible button around `x=1349,y=271,w=88,h=32`
- Treat it as the 51job equivalent of BOSS "打招呼". Only click it after the 51job proactive-contact gates pass; use dryRun for selector checks.

Potential blocker:

- Guide popover: `#driver-popover-item`
- Text: `新人才、意向推荐、学生频道搬家啦！`
- Safe close/skip candidate: `button.driver-close-btn`, text `跳过`
- Only close it if it blocks inspection or implementation.

## 人才沟通

Top position tabs:

- Position menu: `.position-menu.clearfix`
- All positions: `.menu-item-all.menu-item`
- Active all positions: `.menu-item-all.menu-item.menu-item_active`
- Position item: `.menu-item.menu-item_content_short`
- Position text wrapper: `.job_name_wrap`

Visible positions at check time:

- `全部职位`
- `电气工程师`
- `AI应用开发实习生`
- `销售管培生`
- `销售工程师（石油钻井泥浆膨润土）`
- `外贸销售经理（流变助剂）`
- `膨润土销售人员`
- `机电工程师（嵌入式开发方向）`

Note: at the latest check, `国际业务管培生` and `应用技术经理（工业涂料领域）` were present in 人才望远镜 but not in the visible 人才沟通 tabs; the unread workflow should record `position_tab_not_found` rather than fail when a configured position is not visible in chat.

HRBP handling is configured for the other 51job account as well. Match aliases such as `HRBP`, `人力资源`, and `销售团队HRBP` through the 51job adapter, then reuse the `boss_chat_rules.json` 人力资源 section for chat screening and the HRBP proactive gate: 本科及以上、30 岁以下、人力资源或相关专业。

Conversation filters:

- Left unread checkbox: `label.el-checkbox.btn.unread-checkbox`, text `未读`, around `x=241,y=184,w=46,h=24`
- Left AI checkbox: `label.el-checkbox.btn.aichat-checkbox`, text `AI沟通`, around `x=299,y=184,w=60,h=24`
- Batch toggle: `.im-batch-chat.batch-chat-dot`, text `批量`, around `x=484,y=184,w=24,h=24`
- Search input: `input.el-input__inner[placeholder="搜索姓名"]`, around `x=1216,y=136,w=272,h=28`
- Conversation scroll container: `#conversation-list`, around `x=225,y=215,w=299,h=456`, scroll height around `7193`

Conversation row:

- Row selector: `#conversation-list .list-item`
- Candidate name: `.username.at`
- Job name in row: `.jobname`
- Example first row text: `陈航宇 AI应用开发实习生 ...`
- Row size around `x=225,y=215,w=293,h=80`
- Some rows have unread count shown before candidate name.

Batch panel:

- Right panel root: `section.batch-chat-panel`
- Unread tab: `#tab-unread`, text like `未读·13`
- Read-but-not-replied tab: `#tab-read`, text like `已读未回·50`
- Batch list scroll wrapper: `.batch-chat-list-wrap`, around `x=549,y=225,w=951,h=322`
- Batch item wrapper: `.wrap-item`
- Batch item: `.batch-chat-item`
- Item job/intention line: `.item-container-info.custom-desc`
- Item resume block: `.item-container-resume.custom-flex`
- Candidate name in batch item: `.resume-info-status .name`
- Candidate basic info: `.resume-info-detail`
- Work/education block: `.resume-exp`
- Last message block: `.item-container-message`
- Bottom buttons:
  - `#sensor_Bchat_plbatchread`: 标已读
  - `#sensor_Bchat_plbatchreply`: 批量回复
  - `#sensor_Bchat_plbatunfit`: 不合适

Single-chat view selectors from earlier verified scan:

- Selected candidate name: `div.im_userName`, `span.username-text`
- Resume title in message: `span.info-header-name`, example `陈航宇的在线简历`
- Message item: `div.im-message-item`
- Other side message: `div.message-item.others`
- My message: `div.message-item.mine`
- Bottom operation button: `div.operate-item`
- Not suitable wrapper: `#sensor_Bchatinfo_unfit_wrap`
- Input: `#drop-area.input-textarea_self`, placeholder like `发送给 <候选人>`
- Send button: `button.el-button.new-send-button.el-button--primary`, text `发送`
- AI assistant guide overlay can block sending. Safe cancel button: `button.ai-guide-btn-no`.
- WeChat notify overlay can block sending. Safe close selectors: `.wechat-notify .close`, `.wechat-notify .el-icon-close`.
- Send verification must read recent `div.message-item.mine` entries through the 51job extractor. The generic BOSS extractor can misclassify 51job system/resume text.
- 51job send button should use a direct Playwright `click()` after the normal pause/highlight; the shared humanized click wrapper did not reliably trigger the site's send handler in the chat footer.
- Conversation rows containing `[送达]` or `[已读]` are treated as already handled during unread scanning to avoid immediately reprocessing a freshly sent row.
- Conversation rows containing `[平台推荐]` or the separator `以下是为你推荐的人才` are not recruiter unread conversations and must be skipped in the unread workflow.

Note: in this pass, the page was in batch-panel state. I did not open an unread candidate row to avoid changing unread/read state. Re-verify the single-chat selectors once the user permits opening one already-read conversation.

## Implementation notes

- For proactive greeting, 51job `立即Hi聊` should be guarded by the same position-specific business rules currently used for BOSS.
- For unread processing, 51job already has a batch list with resume summary and last message; this may be faster than opening every single chat, but sending replies should still be serial and human-paced.
- For first implementation, prefer a read-only 51job adapter that can list positions, list cards, list unread/batch items, and extract text. Enable actions only after those readers are stable.
- Do not hard-code coordinates except as fallback diagnostics. Prefer the selectors above and text checks.
- After the user adds missing 51job jobs, re-run position discovery and update the visible position list.
