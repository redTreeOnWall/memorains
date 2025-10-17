import React, { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Chip,
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  ListItemText,
  ListItem,
  List,
  InputAdornment,
  IconButton,
  SelectChangeEvent,
} from "@mui/material";
import { DocumentEntity, DocType } from "../../../interface/DataEntity";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";

// Map DocType enum to readable strings
const docTypeLabels: Record<DocType, string> = {
  [DocType.text]: "Text",
  [DocType.canvas]: "Canvas",
  [DocType.mix]: "Mixed",
};

export interface DocListFilterPanelProps {
  docList: DocumentEntity[];
  open: boolean;
  onClose: () => void;
  onConfirm: (selectedDocs: DocumentEntity[]) => void;
}

export const DocListFilterPanel: React.FC<DocListFilterPanelProps> = ({
  docList,
  open,
  onClose,
  onConfirm,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<DocType[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<DocumentEntity[]>([]);
  const [selectedAll, setSelectedAll] = useState(false);

  // Extract unique document types
  const allTypes = Array.from(new Set(docList.map((doc) => doc.doc_type)));

  // Filter documents based on search term and type
  const filteredDocs = docList.filter((doc) => {
    const matchesSearch =
      !searchTerm || doc.title.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType =
      selectedTypes.length === 0 || selectedTypes.includes(doc.doc_type);
    return matchesSearch && matchesType;
  });

  const handleSelectDoc = (doc: DocumentEntity) => {
    if (selectedDocs.some((d) => d.id === doc.id)) {
      setSelectedDocs(selectedDocs.filter((d) => d.id !== doc.id));
    } else {
      setSelectedDocs([...selectedDocs, doc]);
    }
  };

  const handleSelectAll = () => {
    if (selectedAll) {
      setSelectedDocs([]);
    } else {
      setSelectedDocs(filteredDocs);
    }
    setSelectedAll(!selectedAll);
  };

  const handleConfirm = () => {
    onConfirm(selectedDocs);
    handleClose();
  };

  const handleClose = () => {
    setSearchTerm("");
    setSelectedTypes([]);
    setSelectedDocs([]);
    setSelectedAll(false);
    onClose();
  };

  const handleTypeChange = (event: SelectChangeEvent<DocType[]>) => {
    const value = event.target.value as DocType[];
    setSelectedTypes(value);
  };

  const toggleTypeFilter = (type: DocType) => {
    if (selectedTypes.includes(type)) {
      setSelectedTypes(selectedTypes.filter((t) => t !== type));
    } else {
      setSelectedTypes([...selectedTypes, type]);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">Filter and Select Documents</Typography>
          <IconButton onClick={handleClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        <Box mb={2}>
          <TextField
            fullWidth
            variant="outlined"
            placeholder="Search documents by title..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
          />
        </Box>

        <Box mb={2}>
          <FormControl fullWidth variant="outlined">
            <InputLabel>Filter by Type</InputLabel>
            <Select
              multiple
              value={selectedTypes}
              onChange={handleTypeChange}
              label="Filter by Type"
              renderValue={(selected) => (
                <Box display="flex" flexWrap="wrap" gap={0.5}>
                  {(selected as DocType[]).map((value) => (
                    <Chip
                      key={value}
                      label={docTypeLabels[value]}
                      onDelete={() => toggleTypeFilter(value)}
                      size="small"
                    />
                  ))}
                </Box>
              )}
            >
              {allTypes.map((type) => (
                <MenuItem key={type} value={type}>
                  <Checkbox checked={selectedTypes.indexOf(type) > -1} />
                  <ListItemText primary={docTypeLabels[type]} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          mb={1}
        >
          <Typography variant="subtitle2">
            Selected: {selectedDocs.length} of {filteredDocs.length} documents
          </Typography>
          <Button onClick={handleSelectAll} size="small">
            {selectedAll ? "Deselect All" : "Select All"}
          </Button>
        </Box>

        <List dense>
          {filteredDocs.map((doc) => (
            <ListItem key={doc.id} onClick={() => handleSelectDoc(doc)}>
              <Checkbox
                edge="start"
                checked={selectedDocs.some((d) => d.id === doc.id)}
                tabIndex={-1}
                disableRipple
              />
              <ListItemText
                primary={doc.title}
                secondary={`Type: ${docTypeLabels[doc.doc_type]} • Modified: ${new Date(doc.last_modify_date).toLocaleDateString()}`}
              />
            </ListItem>
          ))}
        </List>

        {filteredDocs.length === 0 && (
          <Typography
            variant="body2"
            color="textSecondary"
            align="center"
            sx={{ py: 3 }}
          >
            No documents match your filters
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button onClick={handleConfirm} variant="contained" color="primary">
          Confirm ({selectedDocs.length})
        </Button>
      </DialogActions>
    </Dialog>
  );
};
