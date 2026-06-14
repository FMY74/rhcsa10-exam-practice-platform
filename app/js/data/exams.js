// Demo exam definition. References only the original sample questions.
const EXAMS = [
 {
  id: "exam-demo",
  name: "Sample Exam (demo)",
  timeLimit: 1800,
  totalScore: 57,
  passScore: 40,
  tasks: [
   { questionId: "s1", points: 10 },
   { questionId: "s2", points: 10 },
   { questionId: "s3", points: 15 },
   { questionId: "s4", points: 12 },
   { questionId: "s5", points: 10 }
  ]
 }
];
if (typeof module !== 'undefined') { module.exports = EXAMS; }
