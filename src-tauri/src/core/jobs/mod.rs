#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobState {
    Queued,
    Running,
    WaitingForApproval,
    Completed,
    Failed,
}
