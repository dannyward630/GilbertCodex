import { Bot, CheckCircle2, Code2, FileSearch, Puzzle, ShieldCheck, Sparkles, Wand2 } from "lucide-react";
import type { PluginSkillOption } from "./pluginCatalog";
import { getSkillMentionMatches } from "./pluginCatalog";

interface SkillMentionPickerProps {
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (skill: PluginSkillOption) => void;
  query: string;
  trigger: "$" | "@";
}

export function SkillMentionPicker({ activeIndex, onActiveIndexChange, onSelect, query, trigger }: SkillMentionPickerProps) {
  const matches = getSkillMentionMatches(query);

  return (
    <div className="skill-mention-picker" role="listbox" aria-label="Skill suggestions">
      <div className="skill-mention-heading">
        <Sparkles size={15} aria-hidden="true" />
        <span>Skills</span>
        {query ? <small>{trigger}{query}</small> : <small>$ skill trigger</small>}
      </div>
      <div className="skill-mention-list">
        {matches.length > 0 ? (
          matches.map((skill, index) => {
            const Icon = getSkillIcon(skill);

            return (
              <button
                key={skill.id}
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                data-active={activeIndex === index}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onActiveIndexChange(index)}
                onClick={() => onSelect(skill)}
              >
                <span className="skill-mention-icon">
                  <Icon size={16} aria-hidden="true" />
                </span>
                <span className="skill-mention-copy">
                  <strong>{skill.title}</strong>
                  <small>{skill.description}</small>
                </span>
                <span className="skill-mention-meta">
                  <strong>{skill.mention}</strong>
                  {skill.aliases[0] ? <small>{skill.aliases[0]}</small> : null}
                </span>
              </button>
            );
          })
        ) : (
          <div className="skill-mention-empty">
            <Puzzle size={16} aria-hidden="true" />
            <span>No matching skills</span>
          </div>
        )}
      </div>
    </div>
  );
}

function getSkillIcon(skill: PluginSkillOption) {
  if (skill.category === "Coding") {
    return Code2;
  }

  if (skill.category === "Research") {
    return FileSearch;
  }

  if (skill.category === "Design") {
    return Wand2;
  }

  if (skill.category === "Security") {
    return ShieldCheck;
  }

  if (skill.category === "Automation") {
    return CheckCircle2;
  }

  return Bot;
}
