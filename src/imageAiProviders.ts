export type ImageAiProvider = 'evolink' | 'openai' | 'fal' | 'bfl';

export interface ImageAiModelOption {
  value: string;
  label: string;
  description: string;
}

export interface ImageAiProviderMeta {
  label: string;
  summary: string;
  strengths: string;
  tradeoffs: string;
  docsUrl: string;
  signupUrl: string;
  keyPlaceholder: string;
  keyLabel: string;
  models: ImageAiModelOption[];
}

export const IMAGE_AI_PROVIDER_ORDER: ImageAiProvider[] = ['evolink', 'fal', 'bfl', 'openai'];

export const IMAGE_AI_PROVIDER_META: Record<ImageAiProvider, ImageAiProviderMeta> = {
  evolink: {
    label: 'Evolink / Raphael',
    summary: 'Cài nhanh, hợp workflow tạo bìa ngay trong app và đã có sẵn tích hợp nền.',
    strengths: 'Ưu tiên sự gọn gàng và ít thao tác: bấm tạo bìa là gửi task nền, lấy kết quả về trực tiếp.',
    tradeoffs: 'Danh mục model hiện hẹp hơn fal hoặc BFL, nên độ linh hoạt chưa cao bằng khi cần thử nhiều phong cách.',
    docsUrl: 'https://docs.evolink.ai/en/api-manual/image-series/z-image-turbo/z-image-turbo-image-generate',
    signupUrl: 'https://evolink.ai/signup',
    keyPlaceholder: 'Dán API key Evolink / Raphael (sk-...)',
    keyLabel: 'API key Evolink',
    models: [
      {
        value: 'z-image-turbo',
        label: 'Z Image Turbo',
        description: 'Luồng Raphael hiện tại, thiên về tốc độ và triển khai nhanh trong app.',
      },
    ],
  },
  fal: {
    label: 'fal',
    summary: 'Rất mạnh khi cần nhiều request, nhiều model và muốn scale nhanh mà không tự host GPU.',
    strengths: 'Nhanh, chịu tải tốt, có hệ sinh thái model rộng. Hợp khi muốn tăng request volume mà vẫn giữ chất lượng khá cao.',
    tradeoffs: 'Nhiều model và thông số hơn nên người dùng phổ thông sẽ cần chọn kỹ hơn để không bị rối.',
    docsUrl: 'https://docs.fal.ai/model-apis/fast-flux',
    signupUrl: 'https://fal.ai/dashboard/keys',
    keyPlaceholder: 'Dán FAL key (thường bắt đầu bằng key hoặc secret của fal)',
    keyLabel: 'FAL key',
    models: [
      {
        value: 'fal-ai/flux/schnell',
        label: 'FLUX.1 Schnell',
        description: 'Nhanh nhất, hợp preview và khối lượng cao.',
      },
      {
        value: 'fal-ai/flux/dev',
        label: 'FLUX.1 Dev',
        description: 'Cân bằng tốt giữa tốc độ và chất lượng cho bìa truyện.',
      },
      {
        value: 'fal-ai/flux-pro/v1.1-ultra',
        label: 'FLUX 1.1 Pro Ultra',
        description: 'Ưu tiên chất lượng cao hơn, hợp bìa cần độ đẹp và chi tiết.',
      },
    ],
  },
  bfl: {
    label: 'Black Forest Labs',
    summary: 'Mạnh về họ FLUX chính chủ, đặc biệt hợp khi muốn prompt adherence tốt và chất lượng production.',
    strengths: 'Chất lượng mạnh, bám prompt tốt, có nhiều tier từ throughput cao tới chất lượng cao.',
    tradeoffs: 'Luồng gọi API cần polling và cấu hình endpoint cụ thể hơn, nên triển khai phức tạp hơn OpenAI một chút.',
    docsUrl: 'https://docs.bfl.ai/flux_2',
    signupUrl: 'https://dashboard.bfl.ai',
    keyPlaceholder: 'Dán BFL API key',
    keyLabel: 'BFL key',
    models: [
      {
        value: 'flux-2-klein-9b',
        label: 'FLUX.2 Klein 9B',
        description: 'Hợp throughput cao nhưng vẫn giữ prompt understanding tốt.',
      },
      {
        value: 'flux-2-pro',
        label: 'FLUX.2 Pro',
        description: 'Bản production ổn định, hợp workflow bìa chính thức.',
      },
      {
        value: 'flux-pro-1.1',
        label: 'FLUX 1.1 Pro',
        description: 'Đời cũ hơn FLUX.2 Pro nhưng vẫn rất mạnh và đáng tin cho bìa.',
      },
    ],
  },
  openai: {
    label: 'OpenAI Image',
    summary: 'Dễ dùng, tài liệu tốt, hợp khi muốn một API gọn và ảnh bám prompt tốt mà không cần học nhiều.',
    strengths: 'Developer experience tốt, API rõ, ảnh bám chỉ dẫn khá tốt và dễ nối với hệ AI text hiện có.',
    tradeoffs: 'Chi phí thường không phải lựa chọn tối ưu nhất nếu bạn cần volume rất lớn.',
    docsUrl: 'https://platform.openai.com/docs/guides/image-generation',
    signupUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'Dán OpenAI API key (sk-...)',
    keyLabel: 'OpenAI key',
    models: [
      {
        value: 'gpt-image-1.5',
        label: 'GPT Image 1.5',
        description: 'Mạnh nhất về chất lượng tổng thể và instruction following.',
      },
      {
        value: 'gpt-image-1',
        label: 'GPT Image 1',
        description: 'Ổn định, cân bằng tốt giữa chất lượng và chi phí.',
      },
      {
        value: 'gpt-image-1-mini',
        label: 'GPT Image 1 Mini',
        description: 'Tiết kiệm hơn, hợp preview và nhu cầu khối lượng cao hơn.',
      },
    ],
  },
};

export function getDefaultImageAiModel(provider: ImageAiProvider): string {
  return IMAGE_AI_PROVIDER_META[provider].models[0]?.value || '';
}
