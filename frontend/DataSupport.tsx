import React, { useState, useEffect } from 'react';
import {
  fetchSections,
  createSection,
  deleteSection,
  updateSection,
  fetchSectionFiles,
  uploadFile,
  deleteFile,
  fetchSectionAnalysis,
  saveSectionAnalysis
} from './services/api';
import { DataPanel } from './DataPanel';
import { IssuanceStatistics } from './IssuanceStatistics';

export const DataSupport: React.FC = () => {
  const [sections, setSections] = useState<Array<{ id: string; name: string; is_custom: number }>>([]);
  const [activeSection, setActiveSection] = useState<string>('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [showIssuanceStats, setShowIssuanceStats] = useState(false);

  // 加载板块列表
  const loadSections = async () => {
    try {
      const data = await fetchSections();
      setSections(data);
      if (data.length > 0 && !activeSection) {
        setActiveSection(data[0].id);
      }
    } catch (error) {
      console.error('加载板块失败:', error);
    }
  };

  useEffect(() => {
    loadSections();
  }, []);

  // 添加板块
  const handleAddSection = async () => {
    if (!newSectionName.trim()) return;

    try {
      const id = `custom_${Date.now()}`;
      await createSection({ id, name: newSectionName.trim(), isCustom: true });
      setNewSectionName('');
      setShowAddModal(false);
      await loadSections();
      setActiveSection(id);
    } catch (error) {
      console.error('创建板块失败:', error);
      alert('创建板块失败');
    }
  };

  // 删除板块
  const handleDeleteSection = async (id: string, isCustom: number) => {
    if (!isCustom) {
      alert('系统默认板块不能删除');
      return;
    }
    if (!confirm('确定要删除这个板块吗？关联的文件和分析数据也将被删除。')) return;

    try {
      await deleteSection(id);
      await loadSections();
      if (activeSection === id && sections.length > 1) {
        const remaining = sections.filter(s => s.id !== id);
        setActiveSection(remaining[0]?.id);
      }
    } catch (error) {
      console.error('删除板块失败:', error);
      alert('删除板块失败');
    }
  };

  // 重命名板块
  const handleRenameSection = async (id: string, currentName: string) => {
    const newName = prompt('请输入新的板块名称:', currentName);
    if (!newName || newName === currentName) return;

    try {
      await updateSection(id, newName);
      await loadSections();
    } catch (error) {
      console.error('重命名板块失败:', error);
      alert('重命名板块失败');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 顶部导航栏 */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 shadow-sm">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-xl font-black text-slate-800">数据支持</h1>
            <p className="text-xs text-slate-500 mt-1">管理各类数据文件和分析报告</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowIssuanceStats(!showIssuanceStats)}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${
                showIssuanceStats
                  ? 'bg-emerald-100 text-emerald-700 border-2 border-emerald-300'
                  : 'bg-slate-100 text-slate-600 border-2 border-transparent hover:bg-slate-200'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              发行量统计
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 transition-all flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              添加板块
            </button>
          </div>
        </div>
      </header>

      {/* 板块标签页 */}
      {!showIssuanceStats && (
        <div className="bg-white border-b border-slate-200 px-6 py-2">
          <div className="max-w-7xl mx-auto flex items-center gap-2 overflow-x-auto">
            {sections.map(section => (
              <div
                key={section.id}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold cursor-pointer transition-all whitespace-nowrap
                  ${activeSection === section.id
                    ? 'bg-indigo-100 text-indigo-700 border-2 border-indigo-300'
                    : 'bg-slate-100 text-slate-600 border-2 border-transparent hover:bg-slate-200'
                  }`}
                onClick={() => setActiveSection(section.id)}
                onDoubleClick={() => handleRenameSection(section.id, section.name)}
              >
                {section.name}
                {section.is_custom === 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSection(section.id, 1);
                    }}
                    className="ml-1 text-slate-400 hover:text-red-500 transition-colors"
                    title="删除板块"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 数据面板 */}
      <main className="max-w-7xl mx-auto p-6">
        {showIssuanceStats ? (
          <IssuanceStatistics />
        ) : activeSection ? (
          <DataPanel
            sectionId={activeSection}
            sectionName={sections.find(s => s.id === activeSection)?.name || ''}
            onRefresh={loadSections}
          />
        ) : null}
      </main>

      {/* 添加板块弹窗 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-96 shadow-2xl">
            <h2 className="text-lg font-bold text-slate-800 mb-4">添加新板块</h2>
            <input
              type="text"
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              placeholder="输入板块名称"
              className="w-full border border-slate-300 rounded-lg px-4 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddSection();
                if (e.key === 'Escape') setShowAddModal(false);
              }}
            />
            <div className="flex gap-3">
              <button
                onClick={handleAddSection}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-all"
              >
                确定
              </button>
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 px-4 py-2 bg-slate-200 text-slate-700 rounded-lg font-bold hover:bg-slate-300 transition-all"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
