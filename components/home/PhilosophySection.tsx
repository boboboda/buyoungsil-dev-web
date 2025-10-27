export default function PhilosophySection() {
  const philosophies = [
    {
      title: "일단 만들어보기",
      description: "완벽함을 추구하기보다 빠르게 프로토타입을 만들고 개선합니다.",
      icon: "🚀"
    },
    {
      title: "AI는 도구일 뿐",
      description: "AI가 코드를 작성하지만, 방향성과 판단은 사람이 합니다.",
      icon: "🧠"
    },
    {
      title: "실패를 기록하기",
      description: "실패한 경험도 소중한 자산입니다. 모든 과정을 투명하게 공유합니다.",
      icon: "📝"
    },
    {
      title: "지속 가능한 개발",
      description: "번아웃 없이 꾸준히 개발할 수 있는 방법을 찾습니다.",
      icon: "♻️"
    }
  ];

  return (
    <section className="w-full py-20 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-gray-800 dark:to-gray-900">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            💭 개발 철학
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            완벽하지 않아도 괜찮습니다. 중요한 건 시작하고, 꾸준히 하는 것입니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {philosophies.map((philosophy, index) => (
            <div
              key={index}
              className="bg-white dark:bg-gray-800 rounded-xl p-8 shadow-md hover:shadow-xl transition-shadow"
            >
              <div className="text-5xl mb-4">{philosophy.icon}</div>
              <h3 className="text-2xl font-bold mb-3">{philosophy.title}</h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                {philosophy.description}
              </p>
            </div>
          ))}
        </div>

        {/* 추가 메시지 */}
        <div className="mt-16 text-center">
          <div className="inline-block bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-lg max-w-3xl">
            <p className="text-xl font-medium text-gray-800 dark:text-gray-200 mb-4">
              "비전공자, 비개발자도 AI를 활용하면<br className="hidden sm:block" />
              충분히 개발자가 될 수 있습니다."
            </p>
            <p className="text-gray-600 dark:text-gray-400">
              - 부영실
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}