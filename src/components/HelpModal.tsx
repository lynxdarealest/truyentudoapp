import { Link2, Upload, ImagePlus, Moon, Plus } from 'lucide-react';
import { motion } from 'motion/react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  if (!isOpen) return null;

  const features = [
    {
      title: 'Relay Base URL 1 ô duy nhất',
      desc: 'Nhập đúng dạng wss://relay2026.vercel.app/code=18101412 (code 4-8 số). Web relay sẽ đọc mã code này để cấp token.',
      icon: <Link2 className="w-5 h-5 text-indigo-600" />,
    },
    {
      title: 'AI từ file (gộp)',
      desc: 'Một luồng nhập file dùng chung, sau đó chọn Dịch truyện hoặc Viết tiếp.',
      icon: <Upload className="w-5 h-5 text-amber-600" />,
    },
    {
      title: 'Hồ sơ cá nhân',
      desc: 'Bạn có thể đổi tên hiển thị và ảnh đại diện ngay trong mục Công cụ.',
      icon: <ImagePlus className="w-5 h-5 text-emerald-600" />,
    },
    {
      title: 'Theme ngày/đêm',
      desc: 'Dùng nút Mặt trăng/Mặt trời ở thanh trên để chuyển giao diện.',
      icon: <Moon className="w-5 h-5 text-purple-600" />,
    },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden"
      >
        <div className="p-8">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-2xl font-serif font-bold text-slate-900">Hướng dẫn sử dụng</h3>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
              <Plus className="w-6 h-6 rotate-45 text-slate-400" />
            </button>
          </div>
          <div className="space-y-6">
            {features.map((feature) => (
              <div key={feature.title} className="flex gap-4">
                <div className="p-3 bg-slate-50 rounded-2xl h-fit">{feature.icon}</div>
                <div>
                  <h4 className="font-bold text-slate-800">{feature.title}</h4>
                  <p className="text-sm text-slate-500 leading-relaxed">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={onClose}
            className="w-full mt-8 py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all"
          >
            Đã hiểu
          </button>
        </div>
      </motion.div>
    </div>
  );
}
