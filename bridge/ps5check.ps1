param([string]$File)
$e = $null; $t = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($File, [ref]$t, [ref]$e)
if ($e) { $e | ForEach-Object { 'PARSE ' + $_.Extent.StartLineNumber + ': ' + $_.Message }; exit 1 }
# syntax that Windows PowerShell 5.1 does not have
$bad = @()
$bad += $ast.FindAll({ param($n) $n.GetType().Name -in @('TernaryExpressionAst', 'PipelineChainAst') }, $true)
$bad += $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.BinaryExpressionAst] -and $n.Operator.ToString() -in @('QuestionQuestion') }, $true)
$bad += $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Operator.ToString() -eq 'QuestionQuestionEquals' }, $true)
$bad += $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.MemberExpressionAst] -and $n.NullConditional }, $true)
$bad += $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.VariableExpressionAst] -and $n.VariablePath.UserPath -eq 'args' -and $n.Parent -is [System.Management.Automation.Language.AssignmentStatementAst] }, $true)
if ($bad.Count) { $bad | ForEach-Object { 'PS7 ONLY line ' + $_.Extent.StartLineNumber + ': ' + $_.Extent.Text.Substring(0, [Math]::Min(80, $_.Extent.Text.Length)) }; exit 2 }
'OK for Windows PowerShell 5.1: no PowerShell 7 syntax'
