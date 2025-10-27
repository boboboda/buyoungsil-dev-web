export default function AboutSection() {
  const features = [
    {
      emoji: "🤖",
      title: "AI 기반 개발",
      description: "ChatGPT와 Claude를 활용한 실전 개발 노하우"
    },
    {
      emoji: "📱",
      title: "실제 서비스",
      description: "앱스토어에 출시된 실제 프로젝트 공개"
    },
    {
      emoji: "📚",
      title: "상세한 기록",
      description: "삽질부터 성공까지 모든 과정 공유"
    },
    {
      emoji: "💡",
      title: "비개발자 시점",
      description: "비전공자도 따라할 수 있는 쉬운 설명"
    }
  ];

  return (
    <section className="w-full py-20 bg-white dark:bg-gray-900">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            왜 이 블로그를 만들었나요?
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            비개발자도 AI를 활용하면 실제 서비스를 만들 수 있다는 것을 증명하고,
            <br className="hidden md:block" />
            그 과정을 상세히 공유하기 위해 시작했습니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {features.map((feature, index) => (
            <div
              key={index}
              className="text-center p-6 rounded-xl bg-gray-50 dark:bg-gray-800 hover:shadow-lg transition-shadow"
            >
              <div className="text-5xl mb-4">{feature.emoji}</div>
              <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
              <p className="text-gray-600 dark:text-gray-400">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}