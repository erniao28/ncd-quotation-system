import React, { useState, useEffect, useRef } from 'react';
import {
  fetchSectionFiles,
  uploadFile,
  deleteFile,
  fetchSectionAnalysis,
  saveSectionAnalysis,
  deleteAnalysis
} from './services/api';
import { DataChart, ChartPresets } from './components/DataChart';

interface DataFile {
  id: string;
  filename: string;
  file_type: string;
  uploaded_at: number;
}

interface AnalysisData {
  id: string;
  data_json: any;
  created_at: number;
}

interface DataPanelProps {
  sectionId: string;
  sectionName: string;
  onRefresh: () => void;
}

export const DataPanel: React.FC<DataPanelProps> = ({ sectionId, sectionName, onRefresh }) => {
  const [files, setFiles] = useState<DataFile[]>([]);
  const [analysisList, setAnalysisList] = useState<AnalysisData[]>([]);
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<'files' | 'analysis'>('files');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 加载文件和分析数据
  const loadData = async () => {
    try {
      const [filesData, analysisData] = await Promise.all([
        fetchSectionFiles(sectionId),
        fetchSectionAnalysis(sectionId)
      ]);
      setFiles(filesData);
      setAnalysisList(analysisData);
    } catch (error) {
      console.error('加载数据失败:', error);
    }
  };

  useEffect(() => {
    loadData();
  }, [sectionId]);

  // 处理文件上传
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // 检查文件类型
    const fileType = selectedFile.type;
    let category = 'other';
    if (fileType.includes('excel') || fileType.includes('spreadsheet') || selectedFile.name.endsWith('.xlsx') || selectedFile.name.endsWith('.xls')) {
      category = 'excel';
    } else if (fileType.includes('pdf') || selectedFile.name.endsWith('.pdf')) {
      category = 'pdf';
    } else if (fileType.includes('image') || selectedFile.name.endsWith('.png') || selectedFile.name.endsWith('.jpg') || selectedFile.name.endsWith('.jpeg')) {
      category = 'image';
    }

    setUploading(true);
    try {
      // 读取文件为 Base64
      const fileData = await readFileAsBase64(selectedFile);
      await uploadFile(sectionId, selectedFile.name, category, fileData);
      await loadData();
      alert('上传成功');
    } catch (error) {
      console.error('上传失败:', error);
      alert('上传失败');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 读取文件为 Base64
  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // 删除文件
  const handleDeleteFile = async (id: string) => {
    if (!confirm('确定要删除这个文件吗？')) return;
    try {
      await deleteFile(id);
      await loadData();
    } catch (error) {
      console.error('删除失败:', error);
      alert('删除失败');
    }
  };

  // 下载文件
  const handleDownloadFile = async (file: DataFile) => {
    try {
      const fileData = await fetch(`/api/data/files/${file.id}`).then(r => r.json());
      if (fileData.file_data) {
        const link = document.createElement('a');
        link.href = fileData.file_data;
        link.download = file.filename;
        link.click();
      }
    } catch (error) {
      console.error('下载失败:', error);
      alert('下载失败');
    }
  };

  // 保存分析数据
  const handleSaveAnalysis = async (data: any) => {
    try {
      await saveSectionAnalysis(sectionId, data);
      await loadData();
      alert('分析已保存');
    } catch (error) {
      console.error('保存分析失败:', error);
      alert('保存失败');
    }
  };

  // 删除分析
  const handleDeleteAnalysis = async (id: string) => {
    if (!confirm('确定要删除这条分析吗？')) return;
    try {
      await deleteAnalysis(id);
      await loadData();
    } catch (error) {
      console.error('删除分析失败:', error);
      alert('删除失败');
    }
  };

  // 格式化日期
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN');
  };

  // 获取文件类型图标
  const getFileIcon = (type: string) => {
    switch (type) {
      case 'excel': return '📊';
      case 'pdf': return '📄';
      case 'image': return '🖼️';
      default: return '📁';
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200">
      {/* 操作栏 */}
      <div className="p-4 border-b border-slate-200 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('files')}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all
              ${activeTab === 'files' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            文件管理
          </button>
          <button
            onClick={() => setActiveTab('analysis')}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all
              ${activeTab === 'analysis' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            数据分析
          </button>
        </div>
        {activeTab === 'files' && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.pdf,.png,.jpg,.jpeg"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className={`px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition-all flex items-center gap-2
                ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {uploading ? (
                <>上传中...</>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  上传文件
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* 文件列表 */}
      {activeTab === 'files' && (
        <div className="p-4">
          {files.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <div className="text-4xl mb-2">📂</div>
              暂无文件，请上传
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {files.map(file => (
                <div key={file.id} className="border border-slate-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <span className="text-2xl">{getFileIcon(file.file_type)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{file.filename}</p>
                        <p className="text-xs text-slate-500">{formatDate(file.uploaded_at)}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => handleDownloadFile(file)}
                      className="flex-1 px-2 py-1 bg-slate-100 text-slate-700 text-xs font-bold rounded hover:bg-slate-200 transition-all"
                    >
                      下载
                    </button>
                    <button
                      onClick={() => handleDeleteFile(file.id)}
                      className="flex-1 px-2 py-1 bg-red-50 text-red-600 text-xs font-bold rounded hover:bg-red-100 transition-all"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 数据分析 */}
      {activeTab === 'analysis' && (
        <div className="p-4">
          <AnalysisEditor
            sectionId={sectionId}
            sectionName={sectionName}
            existingAnalysis={analysisList}
            onSave={handleSaveAnalysis}
            onDelete={handleDeleteAnalysis}
          />
        </div>
      )}
    </div>
  );
};

// 分析编辑器组件
interface AnalysisEditorProps {
  sectionId: string;
  sectionName: string;
  existingAnalysis: AnalysisData[];
  onSave: (data: any) => void;
  onDelete: (id: string) => void;
}

const AnalysisEditor: React.FC<AnalysisEditorProps> = ({
  sectionId,
  sectionName,
  existingAnalysis,
  onSave,
  onDelete
}) => {
  const [showEditor, setShowEditor] = useState(false);
  const [analysisTitle, setAnalysisTitle] = useState('');
  const [chartType, setChartType] = useState<'line' | 'bar' | 'pie'>('bar');
  const [dataInputMethod, setDataInputMethod] = useState<'manual' | 'form'>('form');
  const [jsonInput, setJsonInput] = useState('');

  // 表单输入状态（根据板块类型动态变化）
  const [formDataItems, setFormDataItems] = useState<Array<{ name: string; value: number }>>([
    { name: '', value: 0 }
  ]);

  // 预设板块的图表类型建议
  const getRecommendedChartType = () => {
    switch (sectionName) {
      case '到期日':
      case '到期量':
      case '发行量':
        return 'bar';
      case '存单剩余额度':
        return 'bar';
      default:
        return 'bar';
    }
  };

  const handleAddFormItem = () => {
    setFormDataItems([...formDataItems, { name: '', value: 0 }]);
  };

  const handleRemoveFormItem = (index: number) => {
    if (formDataItems.length === 1) {
      alert('至少保留一项数据');
      return;
    }
    setFormDataItems(formDataItems.filter((_, i) => i !== index));
  };

  const handleFormItemChange = (index: number, field: 'name' | 'value', value: string | number) => {
    const newItems = [...formDataItems];
    newItems[index] = { ...newItems[index], [field]: value };
    setFormDataItems(newItems);
  };

  const handleSave = () => {
    let chartData;

    if (dataInputMethod === 'form') {
      // 验证表单数据
      const validItems = formDataItems.filter(item => item.name.trim() !== '');
      if (validItems.length === 0) {
        alert('请至少添加一项有效数据');
        return;
      }
      chartData = {
        type: chartType,
        title: analysisTitle,
        data: validItems.map(item => ({ name: item.name, value: Number(item.value) }))
      };
    } else {
      // JSON 输入
      try {
        const parsed = JSON.parse(jsonInput);
        chartData = {
          type: chartType,
          title: analysisTitle,
          data: parsed
        };
      } catch (e) {
        alert('JSON 格式错误，请检查输入');
        return;
      }
    }

    onSave(chartData);
    setAnalysisTitle('');
    setJsonInput('');
    setFormDataItems([{ name: '', value: 0 }]);
    setShowEditor(false);
  };

  return (
    <div>
      {/* 已保存的分析列表 */}
      {existingAnalysis.length > 0 && (
        <div className="space-y-4 mb-6">
          <h3 className="text-sm font-bold text-slate-700">已保存的分析</h3>
          {existingAnalysis.map(item => (
            <div key={item.id} className="border border-slate-200 rounded-lg p-4">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h4 className="font-bold text-slate-800">{item.data_json?.title || '未命名分析'}</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    创建于 {new Date(item.created_at).toLocaleString('zh-CN')}
                  </p>
                </div>
                <button
                  onClick={() => onDelete(item.id)}
                  className="text-red-500 hover:text-red-700 text-sm font-bold"
                >
                  删除
                </button>
              </div>
              {/* 图表展示 */}
              {item.data_json?.data && Array.isArray(item.data_json.data) && (
                <DataChart
                  data={item.data_json.data}
                  chartType={item.data_json.type || 'bar'}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* 新建分析按钮 */}
      {!showEditor && (
        <button
          onClick={() => {
            setChartType(getRecommendedChartType());
            setShowEditor(true);
          }}
          className="w-full py-4 border-2 border-dashed border-slate-300 rounded-lg text-slate-400 font-bold hover:border-indigo-400 hover:text-indigo-600 transition-all"
        >
          + 新建分析
        </button>
      )}

      {/* 分析编辑器 */}
      {showEditor && (
        <div className="border border-slate-200 rounded-lg p-4 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-slate-800">新建分析 - {sectionName}</h3>
            <button
              onClick={() => setShowEditor(false)}
              className="text-slate-400 hover:text-slate-600 text-xl font-bold"
            >
              ×
            </button>
          </div>

          {/* 分析标题 */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">分析标题</label>
            <input
              type="text"
              value={analysisTitle}
              onChange={(e) => setAnalysisTitle(e.target.value)}
              placeholder="例如：2024 年 3 月到期分析"
              className="w-full border border-slate-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* 图表类型选择 */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">图表类型</label>
            <div className="flex gap-2">
              <button
                onClick={() => setChartType('line')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-bold border-2 transition-all
                  ${chartType === 'line' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}
              >
                📈 折线图
              </button>
              <button
                onClick={() => setChartType('bar')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-bold border-2 transition-all
                  ${chartType === 'bar' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}
              >
                📊 柱状图
              </button>
              <button
                onClick={() => setChartType('pie')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-bold border-2 transition-all
                  ${chartType === 'pie' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}
              >
                🥧 饼图
              </button>
            </div>
          </div>

          {/* 数据输入方式选择 */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">数据输入方式</label>
            <div className="flex gap-2">
              <button
                onClick={() => setDataInputMethod('form')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-bold border-2 transition-all
                  ${dataInputMethod === 'form' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}
              >
                📝 表单输入
              </button>
              <button
                onClick={() => setDataInputMethod('manual')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-bold border-2 transition-all
                  ${dataInputMethod === 'manual' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}
              >
                💻 JSON 输入
              </button>
            </div>
          </div>

          {/* 表单输入 */}
          {dataInputMethod === 'form' && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="block text-sm font-bold text-slate-700">数据项</label>
                <button
                  onClick={handleAddFormItem}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-700"
                >
                  + 添加数据项
                </button>
              </div>
              {formDataItems.map((item, index) => (
                <div key={index} className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={item.name}
                    onChange={(e) => handleFormItemChange(index, 'name', e.target.value)}
                    placeholder="名称（如：1M、3M 或日期）"
                    className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <input
                    type="number"
                    value={item.value}
                    onChange={(e) => handleFormItemChange(index, 'value', parseFloat(e.target.value) || 0)}
                    placeholder="数值"
                    className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    onClick={() => handleRemoveFormItem(index)}
                    className="text-red-400 hover:text-red-600 font-bold text-lg"
                  >
                    ×
                  </button>
                </div>
              ))}
              {/* 图表预览 */}
              {formDataItems.some(item => item.name.trim() !== '') && (
                <div className="mt-4">
                  <DataChart
                    data={formDataItems.filter(item => item.name.trim() !== '').map(item => ({
                      name: item.name,
                      value: item.value
                    }))}
                    chartType={chartType}
                  />
                </div>
              )}
            </div>
          )}

          {/* JSON 输入 */}
          {dataInputMethod === 'manual' && (
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                分析数据（JSON 格式）
              </label>
              <textarea
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                placeholder='[{"name": "1M", "value": 100}, {"name": "3M", "value": 200}]'
                rows={8}
                className="w-full border border-slate-300 rounded-lg px-4 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-slate-500 mt-1">
                格式：[{`{name: "名称", value: 数值}`} , ...]
              </p>
            </div>
          )}

          {/* 保存/取消按钮 */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-all"
            >
              保存分析
            </button>
            <button
              onClick={() => setShowEditor(false)}
              className="flex-1 px-4 py-2 bg-slate-200 text-slate-700 rounded-lg font-bold hover:bg-slate-300 transition-all"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
