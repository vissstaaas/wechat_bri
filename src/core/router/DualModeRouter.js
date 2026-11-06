/**
 * OmniBridge Dual-Mode Message Router
 * - Fast Rule Engine: <5ms keyword & intent classification
 * - Precise Note vs AI Dual-Flow Distinction
 */
export class DualModeRouter {
  /**
   * 判断是否具备明确的备忘录存储意图 (Note Intent)
   */
  static isNoteIntent(text, hasMedia = false) {
    if (hasMedia) return true;
    const t = (text || "").trim();
    if (!t) return false;

    // 1. 明确的存备忘录前缀或指令口令
    if (/^(记一下|记个|备忘|存档|记录|保存|存下|存一下|稍后读|随手记|笔记|#记|\/记|todo[:：]|待办[:：]|待办事项|备忘录[:：]|笔记[:：])/i.test(t)) {
      return true;
    }

    // 2. 链接稍后读 (含有 URL)
    if (/(https?:\/\/|www\.)[^\s]+/i.test(t)) {
      return true;
    }

    // 如果包含明显的疑问/指令词，优先认为是提问/检索，而非纯存储
    const isAsking =
      /[?？]$/.test(t) ||
      /(是多少|在哪|怎么查|帮我查|查一下|找一下|搜一下|告诉我|有哪些|有什么|发给我|发我|提取|调出|发来)/.test(t);

    if (isAsking) {
      return false;
    }

    // 3. 账号密码凭据类 (含有特征词 + 包含密码/数字/冒号等具体内容)
    const hasKeyWord = /(密码|账号|户号|卡号|身份证|密钥|token|pin|验证码|wifi|学号)/i.test(t);
    const hasCredentialBody = /[\d\w]{4,}|[:：\s]+[^\s]+/i.test(t);
    if (hasKeyWord && hasCredentialBody) {
      return true;
    }

    // 4. 快递取件码 / 具体待办
    const hasTodoWord = /(取件码|快递|顺丰|丰巢|菜鸟|自提码)/i.test(t);
    if (hasTodoWord && /[\d-]{3,}|[一二三四五六七八九十\d]+号/.test(t)) {
      return true;
    }

    // 含有具体时间 + 事项动作 (如 "明天下午4点开会", "后天记得买牛奶")
    const hasTimeAction = /(明天|后天|大后天|周[一二三四五六日天]|星期[一二三四五六日天]|下午|上午|晚上|点半|\d+点).*(去|开会|买|交|拿|寄|发|办|联系|提醒)/.test(t);
    if (hasTimeAction) {
      return true;
    }

    // 5. 结构化待办打勾列表
    if (/^(\s*[-*]\s*\[[\s xX]\]|\d+\.\s+)/m.test(t)) {
      return true;
    }

    return false;
  }

  /**
   * 判断是否属于 AI 问答、指令或对话交流 (AI Intent)
   */
  static isAiIntent(text) {
    const t = (text || "").trim();
    if (!t) return false;

    // 强制 AI 指令
    if (/^(\/ai|\/ask|\/chat|ai[:：]|问[:：]|求问)/i.test(t)) return true;

    // 1. 问句标志（标点或疑问语气词）
    if (/[?？]$/.test(t)) return true;
    if (/(吗|呢|吧|啊|呀|？|\?|啥|什么|干嘛|做啥|干啥|是干什么的|干嘛的|有啥用|怎么用|能干嘛|能做什么|你会什么|功能|帮助|介绍一下)/i.test(t)) return true;
    if (/(怎么|怎样|如何|为何|为什么|是谁|谁|哪|哪个|哪些|多少|几|有没有|是不是|能不能|可不可以|可否|行不行|好不好|咋样|咋办|忘了|想问|请教)/i.test(t)) return true;

    // 2. 问候、闲聊与机器人身份询问
    if (/^(你好|您好|嗨|hello|hi|哈喽|在吗|在不在|你是谁|早安|晚安|测试|test|有人吗|呼叫|呼叫AI)/i.test(t)) return true;
    if (/^(是干嘛的|做什么的|干啥的|你能做什么|怎么用|帮助|说明|功能)/i.test(t)) return true;

    // 3. AI 任务动词开头的指令
    if (/^(请问|帮我|给我|告诉我|生成|写|编写|编一个|写个|写一个|写出|实现|总结|翻译|解释|分析|算一下|计算|背诵|讲个|说个|推荐|评价|优化|修改|润色|查一下|找一下|搜一下|把)/i.test(t)) return true;

    // 4. 算法、代码、学术、生活问答关键词
    if (/(算法|排序|冒泡|代码|python|javascript|vue|react|模型|deepseek|openai|gpt|chatgpt|ai助手|写一首|讲故事|笑话)/i.test(t)) return true;

    // 5. 调取云盘、相册图片、备忘录检索
    if (/(相册|图库|照片|图片|截图|云盘|icloud|简历|课表|文件).*(发给我|发我|找|搜|查|提取|调出|看看|有哪些|有什么)/i.test(t)) return true;
    if (/^把.*(发给我|发我|发一下|调出来|发群里)/.test(t)) return true;

    // 6. 提问个人备忘录
    if (/(我之前记的|我备忘录里|备忘录里的|查一下备忘录|密码是多少|取件码是多少)/i.test(t)) return true;

    return false;
  }

  static classifyIntent(text, rules, hasMedia = false) {
    const t = (text || "").trim();
    const lower = t.toLowerCase();

    const isExplicitNote = /^(记一下|记个|备忘|存档|#记|\/记|todo[:：]|待办[:：])/i.test(t);
    const isNote = isExplicitNote || this.isNoteIntent(t, hasMedia);
    const isAi = this.isAiIntent(t);

    // 智能双模决策逻辑：
    // 1. 如果用户显式要求记笔记（前缀如"记一下"） -> 100% 备忘录
    // 2. 如果包含明确的 AI 提问、任务指令、闲聊、问答或搜索意图 -> 智能路由给 AI Agent
    // 3. 如果包含图片/媒体文件 -> 自动归档进备忘录并生成相册视觉索引
    // 4. 其他随手记声明式文本（如想法、账号、待办、网址、备忘内容） -> 智能分类归纳进 iPhone 备忘录
    const isQuestionOrChat = !isExplicitNote && isAi;

    const rawWeights = {};
    let matchedAny = false;

    for (const r of rules) {
      let hits = 0;
      for (const kw of r.keywords) {
        if (kw && lower.includes(kw.toLowerCase())) hits++;
      }
      if (hits > 0) {
        rawWeights[r.id] = 10 + hits * 15;
        matchedAny = true;
      } else {
        rawWeights[r.id] = r.id === "idea" ? 2 : 0.4;
      }
    }

    if (!matchedAny) {
      rawWeights["idea"] = 25;
    }

    const totalWeight = Object.values(rawWeights).reduce((a, b) => a + b, 0) || 1;
    const probabilities = {};
    for (const r of rules) {
      probabilities[r.id] = Number((rawWeights[r.id] / totalWeight).toFixed(2));
    }

    const sorted = [...rules].sort((a, b) => (probabilities[b.id] || 0) - (probabilities[a.id] || 0));
    const topRule = sorted[0] || rules[0];

    return {
      isQuestionOrChat,
      isNote,
      topCategory: topRule.id,
      categoryName: topRule.fileName,
      rule: topRule,
      siriPrompt: topRule.siriPrompt || `“嘿 Siri，查一下我备忘录里的 ${topRule.title}”`,
      probabilities
    };
  }
}
