export const MTU_ACADEMIC_OPTIONS = [
  {
    college: "College of Basic and Applied Sciences",
    programmes: ["Computer Science", "Software Engineering", "Cyber Security", "Data Science", "Biochemistry", "Biotechnology", "Microbiology", "Industrial Chemistry", "Physics", "Mathematics", "Environmental Management & Toxicology"],
  },
  {
    college: "College of Humanities, Management and Social Sciences",
    programmes: ["Accounting", "Business Administration", "Economics", "English", "Finance", "International Relations", "Mass Communication", "Public Administration", "Music", "Religious Studies", "Personnel Management"],
  },
  {
    college: "College of Allied Health Sciences",
    programmes: ["Nursing Science", "Medical Laboratory Science", "Public Health", "Community Health", "Nutrition & Dietetics"],
  },
] as const;

export const MTU_LEVEL_OPTIONS = ["100 Level", "200 Level", "300 Level", "400 Level", "500 Level"] as const;

export const MTU_COLLEGE_OPTIONS = MTU_ACADEMIC_OPTIONS.map(({ college }) => college);
export const MTU_PROGRAMME_OPTIONS = MTU_ACADEMIC_OPTIONS.flatMap(({ programmes }) => programmes);

export function programmesForCollege(college: string): string[] {
  return [...(MTU_ACADEMIC_OPTIONS.find((option) => option.college === college)?.programmes || [])];
}
