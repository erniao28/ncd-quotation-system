
import { GoogleGenAI, Type } from "@google/genai";
import { Quotation, MaturityInfo } from "../types";

// 硬编码 API Key
const API_KEY = 'AIzaSyCtTaEi5Gw-L8I3ZWc8nnvRWBMRJ6DBNDQ';

const STANDARD_BANKS = `
【大行及股份制 - 归类为 BIG】
工商银行 农业银行 中国银行 建设银行 交通银行 邮储银行
中信银行 光大银行 华夏银行 广发银行 平安银行 招商银行 浦发银行 兴业银行 浙商银行 渤海银行 恒丰银行

【城商行 - 归类为 AAA 或更低】
北京银行 上海银行 江苏银行 宁波银行 南京银行 杭州银行 厦门国际银行 汉口银行 长沙银行 成都银行 重庆银行 贵阳银行 郑州银行 青岛银行 西安银行 苏州银行 河北银行 哈尔滨银行 大连银行 盛京银行 吉林银行 内蒙古银行 宁夏银行 甘肃银行 中原银行 湖北银行 温州银行 台州银行 厦门银行 齐鲁银行 威海银行 晋商银行 东莞银行 广州银行 珠海华润银行 泰隆银行 青海银行 新疆银行 绍兴银行 湖州银行 嘉兴银行 金华银行 海峡银行 泉州银行 赣州银行 上饶银行 日照银行 烟台银行 齐商银行 华兴银行 民泰银行 邯郸银行 邢台银行 沧州银行 承德银行 衡水银行 乌海银行 鄂尔多斯银行 抚顺银行 鞍山银行 丹东银行 营口银行 阜新银行 辽阳银行 铁岭银行 朝阳银行

【农商行 - 归类为 AAA 或更低】
重庆农商 上海农商 广州农商 深圳农商 东莞农商 顺德农商 天津农商 武汉农商 长沙农商行 江南农商 南海农商 珠海农商 佛山农商 无锡农商 常熟农商 张家港农商 江阴农商 吴江农商 太仓农商 昆山农商
`;

export async function parseMaturityDates(text: string): Promise<MaturityInfo[]> {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `请从以下文本中提取 NCD 到期日信息。
    输入示例: "(1M 到期日 2025/10/16 周四)"
    输出 JSON 数组。
    文本: ${text}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            tenor: { type: Type.STRING },
            date: { type: Type.STRING },
            weekday: { type: Type.STRING }
          },
          required: ["tenor", "date", "weekday"]
        }
      }
    }
  });
  return JSON.parse(response.text || "[]");
}

export async function parseQuotations(text: string, defaultWeekday: string): Promise<Partial<Quotation>[]> {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `你是一个专业的金融 NCD 数据录入员。
    
    【目标格式】: "兴业银行 AAA 周一 6M 1.62%"
    【默认起息星期】: ${defaultWeekday}
    
    【标准银行参考库】:
    ${STANDARD_BANKS}

    【任务】:
    解析输入的 NCD 报价文本，将其转换为 JSON 数组。
    1. bankName: 提取银行名称。
    2. rating: 评级，如 AAA, AA+。
    3. category: 根据银行属性选择 'BIG' (大行/股份制), 'AAA' (AAA级城农商), 'AAplus' (AA+级), 或 'AA_BELOW'。
    4. tenor: 统一为 1M, 3M, 6M, 9M, 1Y。
    5. yieldRate: 仅提取数字，如 "1.62"。
    6. volume: 提取如 "40e" 或 "20亿"。
    
    输入内容:
    ${text}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            bankName: { type: Type.STRING },
            rating: { type: Type.STRING },
            category: { type: Type.STRING, enum: ['BIG', 'AAA', 'AAplus', 'AA_BELOW'] },
            tenor: { type: Type.STRING },
            yieldRate: { type: Type.STRING },
            volume: { type: Type.STRING },
            remarks: { type: Type.STRING },
            weekday: { type: Type.STRING }
          },
          required: ["bankName", "tenor", "yieldRate", "category"]
        }
      }
    }
  });

  const resultText = response.text;
  if (!resultText) return [];
  
  try {
    return JSON.parse(resultText);
  } catch (e) {
    console.error("AI 响应解析 JSON 失败:", resultText);
    return [];
  }
}
