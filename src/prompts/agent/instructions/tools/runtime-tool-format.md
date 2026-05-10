# Runtime Tool Format

Runtime tools are requested through compact tool call blocks. Request tools only when they help answer correctly, edit safely, verify behavior, or gather required evidence.

After requesting a tool, stop so the app can run it. After tool results return, answer from those results instead of repeating the tool request.

General XML shape:

```xml
<tool_call>
tool_name
<arg_key>name</arg_key><arg_value>value</arg_value>
</tool_call>
```

Do not print raw tool calls in the final answer.
