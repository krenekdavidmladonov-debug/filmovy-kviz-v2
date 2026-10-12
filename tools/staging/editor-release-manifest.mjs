// Every export below participates in a changed persisted or publication contract.
export const editorReleaseGroups = {
  "editor/callables": [
    "createQuizRound",
    "createQuizSlide",
    "updateQuizSlide",
    "updateQuizMetadata",
    "deleteQuizSlide",
    "duplicateQuizSlide",
    "moveQuizSlide",
    "updateQuizRound",
    "reorderQuizQuestion",
    "moveQuizQuestionToRound",
    "duplicateQuizRound",
    "moveQuizRound",
    "removeQuizRound"
  ],
  "live/callables": [
    "createLiveSession",
    "goToSlide",
    "nextSlide",
    "previousSlide",
    "revealAnswer",
    "hideAnswer",
    "selectRecapQuestion",
    "playMedia",
    "stopMedia",
    "replayMedia",
    "finishMedia",
    "startIntro",
    "endLiveSession",
    "reportMediaPlayback"
  ],
  "events/callables": [
    "lockEventQuiz"
  ],
  "leaderboard/callables": [
    "controlInterimResults"
  ],
  "final-reveal/callables": [
    "controlFinalReveal"
  ],
  "media/callables": [
    "beginQuizMediaUpload",
    "finalizeQuizMediaUpload"
  ],
  "media/endpoint": [
    "readQuizMedia"
  ]
};
export const editorReleaseFunctions = Object.values(editorReleaseGroups).flat();
export const editorReleaseEntry = Object.entries(editorReleaseGroups).map(([source,names]) => 'export { '+names.join(', ')+' } from \'./'+source+'.js\';').join('\n')+'\n';
export const existingDependencies = ['createQuiz','repairQuizPreflightIssue','createEvent','updateEvent','createEventLiveSession','previewInterimResults','previewFinalResults','listRefereeAccess'];
