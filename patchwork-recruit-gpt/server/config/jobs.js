const path = require("node:path");

function createJobConfig(DATA_DIR) {
  const RESUME_LIBRARY_JOB_TYPES = [
    "AI应用开发实习生",
    "应用技术经理（工业涂料领域）",
    "膨润土销售人员",
    "销售管培生",
    "HRBP",
    "人力资源管培生",
    "国际业务管培生",
    "销售工程师（石油钻井泥浆膨润土）_湖州",
    "电气工程师",
    "运营A",
    "运营B",
  ];
  
  const LEGACY_JOB_TYPES = [
    "AI实习生",
    "AI应用开发工程师",
    "应用技术",
    "应用技术管培生",
    "膨润土销售",
    "石油钻井销售",
    "石油销售",
    "外贸销售",
    "HR",
    "招聘专员",
    "人力资源实习生",
    "内容运营",
    "沙粉销售",
  ];
  
  const JOB_TYPES = [
    ...RESUME_LIBRARY_JOB_TYPES,
    ...LEGACY_JOB_TYPES,
  ];
  const DEFAULT_JOB_TYPE = "AI应用开发实习生";
  const AI_SCORING_JOB_TYPE = "AI应用开发实习生";
  const RESUME_COPY_DIR = path.join(DATA_DIR, "resume-copy-pdfs");
  const RESUME_JOB_DISPLAY_LABELS = {
    "AI应用开发实习生": "AI实习生",
    "应用技术经理（工业涂料领域）": "应用技术",
    "人力资源管培生": "人资管培",
    "销售工程师（石油钻井泥浆膨润土）_湖州": "石油销售",
    "运营A": "运营A",
    "运营B": "运营B",
  };
  
  const POSITION_SCORING_RULES = {
    "AI实习生": {
      title: "AI应用开发实习生评分规则",
      description: "重点看候选人是否有真实智能体/大模型应用项目，以及能不能说明自己负责的模块和工程落地过程。",
      mustHave: [
        "有大模型、Agent、RAG、工具调用、工作流、知识库或模型应用相关项目/实践经历。",
        "能说明本人在项目中的职责、技术方案和实现过程。",
        "具备基础工程能力，例如 Python、JavaScript、API 服务、数据库、前后端或部署经验。"
      ],
      bonus: [
        "用过 LangChain、LangGraph、LlamaIndex、AutoGen、CrewAI、Dify、Coze、MCP 等框架或平台。",
        "做过 Function Calling、Tool Calling、Embedding、向量数据库、Rerank、多轮记忆、评测等模块。",
        "项目真实上线、可演示，或能说明业务场景、稳定性和效果。",
        "熟悉 Codex、OpenClaw、Claude Code 等 AI 编程或智能体开发工具。"
      ],
      risks: [
        "只有普通管理系统、CRUD、爬虫或传统后端项目，缺少大模型/Agent 落地。",
        "只在技能栏堆关键词，项目里没有对应证据。",
        "项目职责不清楚，无法判断是否真正参与核心实现。"
      ]
    },
    "销售管培生": {
      title: "销售管培生评分规则",
      description: "重点看销售培养潜力、外驱力和客户沟通基础。",
      mustHave: [
        "应届生或校招生背景，方向愿意走销售培养路线。",
        "学历大专及以上。",
        "能接受总部培训、单休和出差等岗位基本安排。"
      ],
      bonus: [
        "市场营销、理工科或岗位相关专业。",
        "有销售、市场、客户沟通、地推、商务拓展等经历。",
        "有班干部、学生会、社团负责人或组织协调经历。",
        "表达外向，目标感强，有明显外驱力。"
      ],
      risks: [
        "明显抗拒销售、出差或客户开发。",
        "纯行政、纯内勤经历且没有客户沟通证据。",
        "表达被动，求职动机弱。"
      ]
    },
    "膨润土销售": {
      title: "膨润土销售评分规则",
      description: "重点看化工原料、涂料原料、膨润土或相近材料销售经验。",
      mustHave: [
        "有涂料原料、膨润土、涂料助剂、建材原料或相近化工材料经验之一。",
        "有销售、客户开发、商务拓展或渠道维护经历。"
      ],
      bonus: [
        "有膨润土销售经验。",
        "熟悉涂料助剂、建筑材料原料或化工原料客户。",
        "有稳定客户资源、大客户开发或区域销售经验。",
        "年龄 30 岁以下优先；有强相关经验可放宽。"
      ],
      risks: [
        "纯销售但没有化工、材料、涂料或工业品背景。",
        "纯行政、客服或门店销售，缺少 B 端客户开发证据。",
        "只写销售岗位名称，无法看出产品和客户类型。"
      ]
    },
    "应用技术": {
      title: "应用技术评分规则",
      description: "重点看工业涂料研发、配方和流变助剂/膨润土应用经验。",
      mustHave: [
        "有工业涂料研发、配方开发、应用测试或技术服务经历。",
        "熟悉工业涂料配方。",
        "熟悉工业涂料流变助剂或膨润土应用。"
      ],
      bonus: [
        "有涂料大厂经验。",
        "有防腐涂料、工业漆、水性涂料等具体方向经验。",
        "能做客户现场技术支持、配方优化或产品改进。",
        "年龄 40 岁以下优先。"
      ],
      risks: [
        "只有销售经历，没有研发、配方或应用技术证据。",
        "只接触普通检测，缺少配方和助剂理解。",
        "行业偏离工业涂料过远。"
      ]
    },
    "HR": {
      title: "人力资源评分规则",
      description: "重点看人力资源专业背景、招聘实践和业务一线适应度。",
      mustHave: [
        "人力资源管理专业优先作为核心判断项。",
        "能接受销售团队 HRBP 方向，需要深入一线学习产品和成交路径。",
        "能接受总部单休和必要出差。"
      ],
      bonus: [
        "有人力资源、招聘或猎头实习经历。",
        "高中理工科背景可加分。",
        "有班干部、学生会或沟通组织经历。",
        "简历体现沟通能力强，应届生或大三可重点看。"
      ],
      risks: [
        "纯行政、人事文员经历，缺少招聘或业务支持意识。",
        "不愿意深入一线或不接受出差。",
        "年龄明显偏大且缺少相关经验。"
      ]
    },
    "HRBP": {
      title: "HRBP评分规则",
      description: "沿用人力资源岗位规则，额外关注业务理解和一线支持能力。",
      inherit: "HR"
    },
    "招聘专员": {
      title: "招聘专员评分规则",
      description: "重点看招聘全流程、渠道运营和候选人沟通能力。",
      mustHave: [
        "有招聘、简历筛选、面试邀约、候选人沟通或渠道维护经验。",
        "能接受岗位对应的业务节奏和线下办公要求。"
      ],
      bonus: [
        "有电商、制造业或销售岗位招聘经验。",
        "熟悉 BOSS、飞书、表格统计或招聘数据复盘。",
        "表达清楚，沟通推进能力强。"
      ],
      risks: [
        "只有纯行政或客服经历，缺少招聘动作。",
        "只做资料整理，未参与招聘闭环。"
      ]
    },
    "人力资源管培生": {
      title: "人力资源管培生评分规则",
      description: "重点看人力资源专业基础、沟通潜力和业务适应度。",
      mustHave: [
        "人力资源管理专业或明确人力资源发展方向。",
        "能接受单休、出差和深入一线学习产品。"
      ],
      bonus: [
        "有人力资源、招聘或猎头实习经历。",
        "班干部、学生会、社团组织经历。",
        "应届生或大三，沟通表达较好。"
      ],
      risks: [
        "只想做办公室行政，不愿接触业务一线。",
        "不接受出差或单休。"
      ]
    },
    "人力资源实习生": {
      title: "人力资源实习生评分规则",
      description: "重点看招聘支持能力、稳定实习时间和沟通执行力。",
      mustHave: [
        "有人力资源、招聘支持、行政人事实习或相关课程/项目经历。",
        "能稳定线下实习。"
      ],
      bonus: [
        "人力资源管理专业。",
        "有候选人沟通、电话邀约、简历筛选经验。",
        "做事细致，表格和文档能力较好。"
      ],
      risks: [
        "只能短期实习或无法线下。",
        "没有沟通执行类经历。"
      ]
    },
    "国际业务管培生": {
      title: "国际业务管培生评分规则",
      description: "重点看外贸销售潜力、英语能力和化工原料相关度。",
      mustHave: [
        "本科及以上。",
        "有外贸、国际业务、海外客户或跨境销售方向意愿。",
        "化工原料相关经历或专业背景优先作为核心判断项。"
      ],
      bonus: [
        "有化工原料外贸销售经历。",
        "英语专八、商务英语能力强，俄语能力可加分。",
        "了解膨润土或流变助剂。",
        "有海外客户开发、展会、询盘跟进经验。"
      ],
      risks: [
        "只有普通英语能力，没有销售或外贸证据。",
        "外贸品类与化工原料完全无关。",
        "年龄明显超过岗位预期且无强相关经验。"
      ]
    },
    "外贸销售": {
      title: "外贸销售评分规则",
      description: "重点看化工原料外贸销售经历、海外客户开发和语言能力。",
      mustHave: [
        "本科及以上。",
        "必须有化工原料相关外贸销售经历。",
        "有海外客户沟通、询盘跟进、订单推进或外贸业务闭环经验。"
      ],
      bonus: [
        "熟悉膨润土。",
        "有流变助剂销售经历。",
        "英语专八或商务英语能力强，俄语能力可加分。",
        "有化工原料海外客户资源。"
      ],
      risks: [
        "只有普通外贸经历，和化工原料无关。",
        "只有英语能力，没有销售闭环或客户开发证据。",
        "年龄明显超过岗位预期且无强相关经验。"
      ]
    },
    "石油销售": {
      title: "石油销售评分规则",
      description: "重点看石油助剂销售、钻井泥浆或油服相关经验。",
      mustHave: [
        "有石油助剂销售经验，或懂钻井泥浆，两者满足任意一个。",
        "学历大专及以上。",
        "有销售、技术服务或油服公司相关经历。"
      ],
      bonus: [
        "同时具备石油助剂销售和钻井泥浆理解。",
        "有油服公司销售或技术经历。",
        "有油田、钻井企业、服务商客户资源。",
        "年龄 45 岁以下优先。"
      ],
      risks: [
        "只有普通工业品销售，没有石油、钻井或助剂背景。",
        "只懂产品但没有客户开发或销售证据。",
        "行业完全不相关。"
      ]
    },
    "石油钻井销售": {
      title: "石油钻井销售评分规则",
      description: "沿用石油销售规则，额外关注钻井泥浆和油田客户场景。",
      inherit: "石油销售"
    },
    "应用技术管培生": {
      title: "应用技术管培生评分规则",
      description: "沿用应用技术规则，适当关注培养潜力、实验室基础和涂料方向匹配度。",
      inherit: "应用技术"
    },
    "沙粉销售": {
      title: "沙粉销售评分规则",
      description: "沿用膨润土销售规则，重点看粉体、建材、化工材料和客户开发经验。",
      inherit: "膨润土销售"
    },
    "电气工程师": {
      title: "电气工程师评分规则",
      description: "重点看 PLC、电气自动化专业、证书和现场调试能力。",
      mustHave: [
        "懂 PLC。",
        "电气自动化或相关专业。",
        "有弱电电工证。",
        "本科及以上。",
        "能接受河北阳原工厂。"
      ],
      bonus: [
        "熟悉 HMI、上位机、CAD、电气图纸。",
        "有现场调试、设备联动、化工或制造业项目经验。",
        "有西门子、三菱等 PLC 实操经验。",
        "年龄 35 岁以下优先。"
      ],
      risks: [
        "只有强电/维修经验，缺少 PLC 或自动化控制。",
        "无证书或专业明显不匹配。",
        "不能接受工厂地点。"
      ]
    }
  };
  Object.assign(POSITION_SCORING_RULES, {
    "AI应用开发实习生": {
      title: "AI应用开发实习生评分规则",
      inherit: "AI实习生",
    },
    "应用技术经理（工业涂料领域）": {
      title: "应用技术经理（工业涂料领域）评分规则",
      inherit: "应用技术",
    },
    "膨润土销售人员": {
      title: "膨润土销售人员评分规则",
      inherit: "膨润土销售",
    },
    "销售工程师（石油钻井泥浆膨润土）_湖州": {
      title: "销售工程师（石油钻井泥浆膨润土）评分规则",
      inherit: "石油销售",
    },
  });
  const JD_TAG_OVERRIDES_PATH = path.join(DATA_DIR, "jd_tag_overrides.json");
  const JD_PROFILE_DEFINITIONS = [
    {
      id: "industrial_coating_application",
      jobType: "应用技术",
      shortTitle: "应用技术",
      matchedJobTypes: ["应用技术", "应用技术管培生"],
      targetRoles: ["应用技术", "技术支持", "涂料应用"],
    },
    {
      id: "bentonite_application",
      jobType: "应用技术",
      shortTitle: "膨润土应用",
      matchedJobTypes: ["应用技术", "应用技术管培生"],
      targetRoles: ["膨润土应用", "流变助剂", "工业涂料"],
    },
    {
      id: "sales_trainee",
      jobType: "销售管培生",
      shortTitle: "销售管培",
      matchedJobTypes: ["销售管培生"],
      targetRoles: ["销售管培生", "销售培养"],
    },
    {
      id: "bentonite_sales",
      jobType: "膨润土销售",
      shortTitle: "膨润土销售",
      matchedJobTypes: ["膨润土销售", "沙粉销售"],
      targetRoles: ["膨润土销售", "工业品销售", "化工材料销售"],
    },
    {
      id: "sand_powder_sales",
      jobType: "沙粉销售",
      shortTitle: "沙粉销售",
      matchedJobTypes: ["沙粉销售"],
      targetRoles: ["沙粉销售", "粉体销售", "建材销售"],
    },
    {
      id: "hrbp",
      jobType: "HRBP",
      shortTitle: "HRBP",
      matchedJobTypes: ["HR", "HRBP", "人力资源", "人力资源管培生", "人力资源实习生", "招聘专员"],
      targetRoles: ["HRBP", "人力资源", "业务 HR"],
    },
    {
      id: "recruiter_specialist",
      jobType: "招聘专员",
      shortTitle: "招聘专员",
      matchedJobTypes: ["HR", "HRBP", "招聘专员"],
      targetRoles: ["招聘专员", "招聘", "候选人沟通"],
    },
    {
      id: "hr_trainee",
      jobType: "人力资源管培生",
      shortTitle: "人力管培",
      matchedJobTypes: ["HR", "HRBP", "人力资源管培生"],
      targetRoles: ["人力资源管培生", "HR 管培"],
    },
    {
      id: "hr_intern",
      jobType: "人力资源实习生",
      shortTitle: "HR 实习",
      matchedJobTypes: ["人力资源实习生", "招聘专员", "HR"],
      targetRoles: ["人力资源实习生", "招聘实习生"],
    },
    {
      id: "international_business_trainee",
      jobType: "外贸销售",
      shortTitle: "外贸销售",
      matchedJobTypes: ["外贸销售", "国际业务管培生"],
      targetRoles: ["外贸销售", "国际业务", "海外销售"],
    },
    {
      id: "oil_drilling_sales",
      jobType: "石油钻井销售",
      shortTitle: "石油钻井销售",
      matchedJobTypes: ["石油销售", "石油钻井销售"],
      targetRoles: ["石油销售", "钻井泥浆", "油田客户"],
    },
    {
      id: "electrical_engineer",
      jobType: "电气工程师",
      shortTitle: "电气工程师",
      matchedJobTypes: ["电气工程师"],
      targetRoles: ["电气工程师", "PLC", "自动化控制"],
    },
  ];
  const JD_MATCH_STOP_WORDS = new Set([
    "相关",
    "经验",
    "经历",
    "背景",
    "岗位",
    "方向",
    "优先",
    "作为",
    "核心",
    "判断项",
    "之一",
    "以上",
    "以下",
    "能力",
    "基础",
    "明确",
    "接受",
  ]);

  return {
    RESUME_LIBRARY_JOB_TYPES,
    LEGACY_JOB_TYPES,
    JOB_TYPES,
    DEFAULT_JOB_TYPE,
    AI_SCORING_JOB_TYPE,
    RESUME_COPY_DIR,
    RESUME_JOB_DISPLAY_LABELS,
    POSITION_SCORING_RULES,
    JD_TAG_OVERRIDES_PATH,
    JD_PROFILE_DEFINITIONS,
    JD_MATCH_STOP_WORDS,
  };
}

module.exports = { createJobConfig };
