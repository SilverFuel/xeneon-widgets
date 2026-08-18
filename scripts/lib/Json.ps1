function ConvertTo-JsonObjectPreservingLexicalTypes($Value) {
  if ($Value -is [System.Collections.IDictionary]) {
    $properties = [ordered]@{}
    foreach ($key in $Value.Keys) {
      $properties[[string]$key] = ConvertTo-JsonObjectPreservingLexicalTypes $Value[$key]
    }
    return [pscustomobject]$properties
  }

  if ($Value -is [System.Collections.IList] -and $Value -isnot [string]) {
    $items = @($Value | ForEach-Object { ConvertTo-JsonObjectPreservingLexicalTypes $_ })
    return ,$items
  }

  return $Value
}

function ConvertFrom-JsonPreservingLexicalTypes {
  param([Parameter(Mandatory = $true)][string]$Json)

  $command = Get-Command ConvertFrom-Json -ErrorAction Stop
  if ($command.Parameters.ContainsKey("DateKind")) {
    return ConvertFrom-Json -InputObject $Json -DateKind String
  }

  Add-Type -AssemblyName System.Web.Extensions -ErrorAction Stop
  $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
  $serializer.MaxJsonLength = 67108864
  return ConvertTo-JsonObjectPreservingLexicalTypes ($serializer.DeserializeObject($Json))
}
