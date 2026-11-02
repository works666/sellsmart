// 各项目关键人物数据 - 从人物主档导入
// 项目一使用新版五人主档；旧项目数据暂保持历史结构，等待各自迁移。
import { PROJECT_ONE_FIVE_PERSON_NPCS, PROJECT_ONE_FIVE_PERSON_IDS } from '@/lib/designer/project-one-five-person';

export const projectNames = [
  '项目一·单单位内部竞标',
  '项目二·国产化改造项目',
  '项目三·大型多部门央企升级',
  '项目四·一体化总包解决方案',
];

const projectOneFivePeople = PROJECT_ONE_FIVE_PERSON_IDS.map((id) => {
  const person = PROJECT_ONE_FIVE_PERSON_NPCS[id];
  return {
    id: person.id,
    name: person.name,
    role: person.title,
    category: person.category,
    level: person.level,
    parentId: person.parentId,
    displayLevel: person.displayLevel,
    displayOrder: person.displayOrder,
    organization: person.organization,
    personalityType: person.personalityType,
    personality: person.personality,
    coreNeeds: person.coreNeeds,
    facts: person.facts,
    clues: person.clues,
    informationBoundary: person.informationBoundary,
    memoryFocus: person.memoryFocus,
    taboos: person.taboos,
    allowedTasks: person.allowedTasks,
  };
});

export const keyPeopleByProject = [
  // 项目一·单单位内部竞标
  projectOneFivePeople,
  // 项目二·国产化改造项目
  [
    { name: '孙磊', role: '一线运维员工', personality: '4种性格随机刷新', weakness: '降低日常运维工作量、设备操作简化、业余兴趣' },
    { name: '周明远', role: '项目总工', personality: '猫头鹰型', weakness: '项目落地政绩、技术成果申报' },
    { name: '吴庆山', role: '采购部长', personality: '孔雀型', weakness: '采购流程简化、领导考核指标' },
    { name: '郑海涛', role: '项目分管副主任', personality: '老虎型', weakness: '政策落地考核、上级单位评价' },
    { name: '徐博文', role: '设计院技术室主任', personality: '老虎型，极度自负傲慢', weakness: '职称晋升、学术论文发表、子女乐器名师资源、行业专家头衔' },
  ],
  // 项目三·大型多部门央企升级
  [
    { name: '马晓军', role: '生产部专员', personality: '一线4种性格随机', weakness: '部门预算扩充、工作减负、项目落地绩效、个人评优' },
    { name: '林泽宇', role: '技术部干事', personality: '一线4种性格随机', weakness: '部门预算扩充、工作减负、项目落地绩效、个人评优' },
    { name: '黄启恒', role: '内部设计岗专员', personality: '一线4种性格随机', weakness: '部门预算扩充、工作减负、项目落地绩效、个人评优' },
    { name: '郭志远', role: '采购专员', personality: '一线4种性格随机', weakness: '部门预算扩充、工作减负、项目落地绩效、个人评优' },
    { name: '陆景明', role: '技术副总工', personality: '老虎型，极度自负傲慢', weakness: '行业顶尖科研资源、个人学术地位提升' },
    { name: '姜卫国', role: '设备分管副总', personality: '老虎型，极少对外接待', weakness: '年度重大项目政绩、行业人脉拓展' },
    { name: '程建峰', role: '总经理', personality: '老虎型', weakness: '女儿海外硕士留学择校资源' },
    { name: '程子昂', role: '总经理直系亲属', personality: '纨绔性格', weakness: '高端人脉资源、休闲娱乐配套资源' },
    { name: '薛建峰', role: '本地合作商', personality: '老虎型，处事谨慎', weakness: '长期稳定政企合作渠道、自有业务拓展机会' },
  ],
  // 项目四·一体化总包解决方案
  [
    { name: '江涛', role: '资产使用经办员', personality: '4种性格随机刷新', weakness: '降低日常运维工作量、设备操作简化、业余兴趣' },
    { name: '吕敬之', role: '资产管理干事', personality: '猫头鹰型', weakness: '项目落地政绩、技术成果申报' },
    { name: '方文彬', role: '采购专员', personality: '孔雀型', weakness: '采购流程简化、领导考核指标' },
    { name: '褚洪波', role: '后勤业务科科长', personality: '老虎型', weakness: '政策落地考核、上级单位评价' },
    { name: '温长明', role: '后勤项目分管副主任', personality: '老虎型，极度自负傲慢', weakness: '职称晋升、学术论文发表、子女乐器名师资源、行业专家头衔' },
    { name: '孙德平', role: 'D厂商业务代表', personality: '孔雀型，只做低价单品业务', weakness: '急于完成季度业绩考核，追求快速签单' },
  ],
];
